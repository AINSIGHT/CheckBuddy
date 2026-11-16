/** 只读查询：积分套餐、本月用量、活跃连签、热力图。任一失败都不影响签到结果。 */
'use strict'

const creds = require('./credentials')

const STREAK_URL = 'https://copilot.tencent.com/activity/growth/streak'

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

function summaryLine(data) {
  const remain = num(data.CycleCapacityRemain != null ? data.CycleCapacityRemain : (data.remain != null ? data.remain : data.remaining))
  const total = num(data.CycleCapacityTotal != null ? data.CycleCapacityTotal : (data.total != null ? data.total : data.limit_num))
  const used = num(data.CycleCapacityUsed != null ? data.CycleCapacityUsed : data.used)
  if (remain == null && total == null) return null
  return '💰 主套餐剩余 ' + (remain != null ? remain : '?') + ' 积分' +
    (total != null ? '(共 ' + total : '') + (used != null ? '，已用 ' + used : '') + (total != null ? ')' : '')
}

async function safeGet(ctx, url, account, method = 'GET') {
  try {
    const resp = await ctx.http.request(method, url, { headers: creds.buildHeaders(account), body: method === 'POST' ? {} : null, timeout: 20000 })
    const d = resp && resp.data
    if (!d || typeof d !== 'object') return null
    return d.data && typeof d.data === 'object' ? d.data : d
  } catch { return null }
}

async function queryAll(ctx, account) {
  const details = []
  const base = creds.baseUrls()[0]

  const s = await safeGet(ctx, base + '/billing/meter/get-user-resource-summary', account, 'POST')
  const line = s && summaryLine(s)
  if (line) details.push(line)
  else if (s) {
    const accounts = s.Accounts || s.accounts
    if (Array.isArray(accounts) && accounts.length) {
      const one = accounts.find((a) => num(a.CycleCapacityRemain) != null) || accounts[0]
      const l = summaryLine(one)
      if (l) details.push(l)
    }
  }

  const used = await safeGet(ctx, base + '/billing/meter/get-user-resource', account, 'POST')
  if (used) {
    const list = Array.isArray(used) ? used : (used.Accounts || used.accounts || used.list || [])
    if (Array.isArray(list) && list.length) details.push('📊 共 ' + list.length + ' 类资源，本月用量已查询')
  }

  const streak = await safeGet(ctx, STREAK_URL, account)
  if (streak) {
    const days = num(streak.streak_days != null ? streak.streak_days : (streak.streakDays != null ? streak.streakDays : streak.days))
    if (days != null) details.push('🔥 活跃连签 ' + days + ' 天（由使用事件驱动，与积分签到连签不同）')
  }

  const heat = await safeGet(ctx, base + '/v2/activity/growth/heatmap', account)
  if (heat) {
    const score = num(heat.score != null ? heat.score : heat.today_score)
    if (score != null) details.push('🌡️ 今日热力图 score=' + score + (score === 0 ? '（尚未点亮，属活跃度问题，不是签到失败）' : ''))
  }

  return details
}

module.exports = { queryAll }
