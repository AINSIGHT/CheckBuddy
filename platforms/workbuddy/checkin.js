/**
 * WorkBuddy 签到状态机：查状态 → 领取 → 回读确认。
 * 原则：HTTP 200 不等于成功；只有官方状态确认 / 结构正确的业务回执才算成功。
 */
'use strict'

const creds = require('./credentials')

const CHECKIN_PATH = '/v2/billing/meter/daily-checkin'

/** 双域名回退 + 可选退避重试；命中 10001 时立即返回，交给上层按业务码分类 */
async function billingRequest(ctx, account, path, { method = 'POST', body = {}, retries = 0 } = {}) {
  let last = { status: 0, data: null }
  for (const base of creds.baseUrls()) {
    let resp
    try {
      resp = await ctx.http.requestWithRetry(method, base + path, {
        headers: creds.buildHeaders(account), body, timeout: 30000,
      }, {
        retries,
        shouldRetry: (r) => !(r && r.data && typeof r.data === 'object' && (r.data.code === 10001 || r.data.code === 11140)),
      })
    } catch (e) {
      last = { status: 0, data: null, error: e }
      continue
    }
    if (resp && resp.data && typeof resp.data === 'object') return resp
    last = resp
    if (resp.status >= 200 && resp.status < 400) return resp
  }
  return last
}

function checkedState(data) {
  if (!data || typeof data !== 'object') return null
  const v = data.today_checked_in != null ? data.today_checked_in
    : (data.todayCheckedIn != null ? data.todayCheckedIn
      : (data.checked_in != null ? data.checked_in : data.isCheckedIn))
  if (v === true || v === 1 || v === '1' || v === 'true') return true
  if (v === false || v === 0 || v === '0' || v === 'false') return false
  return null
}

function isActivityClosed(data) {
  if (!data) return false
  return data.in_period === false || data.active === false ||
    ['closed', 'not_started', 'ended', 'inactive'].includes(String(data.activity_status || data.status || '').toLowerCase())
}

async function getCheckinStatus(ctx, account) {
  for (const path of creds.STATUS_PATHS) {
    try {
      const resp = await billingRequest(ctx, account, path, { retries: 1 })
      const d = resp && resp.data
      if (!d || typeof d !== 'object') continue
      if (d.code !== 0 && d.code !== 200) continue
      const data = d.data && typeof d.data === 'object' ? d.data : d
      if (checkedState(data) !== null || isActivityClosed(data)) return data
    } catch { /* 换下一个状态端点 */ }
  }
  return null
}

function pick(obj, names) {
  for (const n of names) if (obj && obj[n] != null) return obj[n]
  return undefined
}

/** 将签到回执归类，避免把业务错误 / 空回执当成成功 */
function classifyReceipt(resp) {
  const d = resp && resp.data
  if (!d || typeof d !== 'object') {
    return { kind: 'invalid', message: '返回了无效 JSON 或空回执' }
  }
  const msg = String(d.message || d.msg || d.error || '')
  if (resp.status === 401) return { kind: 'unauthorized', message: '登录态失效(401)' }
  if (d.code === 11140 || /request illegal|账号受限/.test(msg)) return { kind: 'restricted', message: '账号受限: ' + msg }
  if (/11-128|unapproved channel/.test(msg)) return { kind: 'channel_blocked', message: '渠道指纹拦截: ' + msg }
  if (d.code === 12153 || /token format/i.test(msg)) return { kind: 'token_format', message: 'RT 格式错误: ' + msg }
  if (resp.status === 500 && d.code === 10001 && /稍后重试/.test(msg)) return { kind: 'retryable', message: msg || '稍后重试' }
  if (resp.status === 400 && d.code === 10001) return { kind: 'enterprise', message: msg || '企业账号不支持该操作' }
  if (d.code !== 0 && d.code !== 200) return { kind: 'biz_error', message: msg || ('业务错误 code=' + d.code) }

  const data = (d.data && typeof d.data === 'object') ? d.data : {}
  if (data.success === false) return { kind: 'biz_error', message: String(data.message || '签到未成功') }
  return {
    kind: 'ok',
    credit: pick(data, ['credit', 'today_credit', 'todayCredit', 'daily_credit', 'dailyCredit']),
    streakDays: pick(data, ['streak_days', 'streakDays']),
    creditDelayed: data.credit_delayed === true || data.creditDelayed === true,
    message: String(data.message || d.message || '签到成功'),
  }
}

/** 执行一次签到领取（不含前置状态判断），供补签队列复用 */
async function signOnce(ctx, account) {
  const resp = await billingRequest(ctx, account, CHECKIN_PATH, { retries: 2 })
  const c = classifyReceipt(resp)
  if (c.kind !== 'ok') return { success: false, kind: c.kind, message: c.message, details: [] }

  const details = []
  if (c.creditDelayed) details.push('积分待入账（credit_delayed），不计为缺少奖励')
  let confirmed = false
  const after = await getCheckinStatus(ctx, account)
  if (after && checkedState(after) === true) {
    confirmed = true
    if (c.streakDays == null) c.streakDays = pick(after, ['streak_days', 'streakDays'])
  } else if (after === null) {
    details.push('状态接口不可用，本次未回读确认，下轮会自动复查')
  } else {
    details.push('回读状态尚未显示已签，标记为待确认，下轮自动复查')
  }
  return {
    success: true, kind: 'ok',
    message: confirmed ? c.message : c.message + '（回读未确认）',
    credit: c.credit, streakDays: c.streakDays, details, confirmed,
  }
}

/** 完整签到流程 */
async function runCheckin(ctx, account) {
  const status = await getCheckinStatus(ctx, account)
  if (status && isActivityClosed(status)) {
    return { success: true, kind: 'inactive', message: '签到活动未开放', details: ['活动未开放属于正常状态，不计失败'] }
  }
  if (status && checkedState(status) === true) {
    return {
      success: true, kind: 'already', message: '今日已签到',
      credit: pick(status, ['today_credit', 'todayCredit', 'daily_credit', 'dailyCredit']),
      streakDays: pick(status, ['streak_days', 'streakDays']),
      details: [],
    }
  }
  const r = await signOnce(ctx, account)
  if (r.kind === 'enterprise') {
    return { success: true, kind: 'enterprise', message: '企业账号，跳过签到', details: ['企业号不支持个人签到与成长体系'] }
  }
  return r
}

module.exports = { CHECKIN_PATH, billingRequest, getCheckinStatus, checkedState, classifyReceipt, signOnce, runCheckin }
