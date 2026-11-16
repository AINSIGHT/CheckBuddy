/**
 * Qoder 签到（多账号）
 * 参考: pi-provider-qoder + iicookies/auto-checkin
 *
 * P0 改进（借鉴 iicookies/auto-checkin）：
 *   1. PAT 交换依次尝试 personal_token / personal_access_token 两种字段名
 *   2. 无效 PAT 返回 HTTP 400（非 401），读 errorCode 给出明确提示
 *   3. claim 时 job token 中途失效 → 重新兑换一次再试
 *   4. QODER_WAIT 分钟等待窗口：本轮活动未下发时每 60 秒重查
 */
'use strict'

const { envInt } = require('../lib/env')
const { isAuthFail } = require('../lib/errors')

const QODER_API_BASE = 'https://openapi.qoder.com.cn'
const QODER_CHECKIN_STATUS_URL = QODER_API_BASE + '/sash/api/v1/me/daily-check-in/status'
const QODER_CHECKIN_CLAIM_URL = QODER_API_BASE + '/sash/api/v1/me/daily-check-in/claim'
const QODER_PAT_EXCHANGE_URL = QODER_API_BASE + '/api/v1/jobToken/exchange'

async function qoderExchangeJobToken(pat, ctx) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Cosy-Version': '1.0.1',
    'Cosy-ClientType': '5',
  }
  let authErr = ''
  let lastErr = ''
  for (const field of ['personal_token', 'personal_access_token']) {
    let resp
    try {
      resp = await ctx.http.request('POST', QODER_PAT_EXCHANGE_URL, {
        headers, body: { [field]: pat }, timeout: 30000,
      })
    } catch (e) {
      lastErr = '网络请求失败: ' + e.message
      continue
    }
    const d = resp.data
    const token = d && (d.token || d.job_token || d.jobToken)
    if (token) {
      let expiresAt = Date.now() + 24 * 60 * 60 * 1000
      if (d.expires_at) {
        const parsed = Date.parse(d.expires_at)
        if (!isNaN(parsed)) expiresAt = parsed
      } else if (d.expires_in) {
        expiresAt = Date.now() + d.expires_in
      }
      return { jobToken: token, jobRefreshToken: d.refresh_token || '', expiresAt }
    }
    if ([400, 401, 403].includes(resp.status)) {
      const detail = d && (d.errorCode || d.errorMessage || d.message || d.error)
      authErr = 'PAT 无效或已过期 (HTTP ' + resp.status + ')' +
        (detail ? ' [' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 80) + ']' : '')
    } else {
      lastErr = (d && (d.message || d.error)) || ('HTTP ' + resp.status)
    }
  }
  throw new Error(authErr || lastErr || 'PAT 交换失败')
}

function buildQoderHeaders(jobToken) {
  return {
    Authorization: 'Bearer ' + jobToken,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Cosy-Version': '1.0.1',
    'Cosy-ClientType': '5',
  }
}

async function qoderEnsureValid(cred, ctx) {
  if (cred.pat) {
    console.log('    [Qoder] 使用 PAT 交换 job token...')
    try {
      const result = await qoderExchangeJobToken(cred.pat, ctx)
      console.log('    [Qoder] PAT 交换成功, job token 有效至 ' + new Date(result.expiresAt).toISOString())
      return { ...cred, token: result.jobToken, refreshToken: result.jobRefreshToken, expiresAt: result.expiresAt }
    } catch (e) {
      console.log('    [Qoder] PAT 交换失败: ' + e.message)
      if (cred.token) {
        console.log('    [Qoder] 回退到已有 token...')
        return cred
      }
      throw e
    }
  }
  return cred
}

/** 本轮活动未下发的判定（保守：仅 4xx 且文案命中，网络错误不进入等待） */
function isCampaignPending(resp, message) {
  if (!resp || resp.status >= 500 || resp.status === 0) return false
  return /未下发|未开始|活动|campaign|暂不可|not found|no campaign/i.test(String(message || ''))
}

async function qoderCheckin(cred, ctx) {
  const validCred = await qoderEnsureValid(cred, ctx)
  let headers = buildQoderHeaders(validCred.token)

  let statusResp
  try {
    statusResp = await ctx.http.request('GET', QODER_CHECKIN_STATUS_URL, { headers, timeout: 30000 })
  } catch { /* 状态查询失败，直接尝试签到 */ }

  const statusData = statusResp && statusResp.data
  if (statusData && statusData.status === 'CLAIMED_TODAY') {
    return {
      success: true, message: '今日已签到',
      credits: statusData.reward_credits || statusData.rewardCredits,
      streakDays: statusData.current_streak_days || statusData.currentStreakDays,
    }
  }

  let claimResp = await ctx.http.request('POST', QODER_CHECKIN_CLAIM_URL, { headers, body: {}, timeout: 30000 })
  // job token 中途过期：重新兑换一次再试
  if (isAuthFail(claimResp) && validCred.pat) {
    try {
      const fresh = await qoderExchangeJobToken(validCred.pat, ctx)
      headers = buildQoderHeaders(fresh.jobToken)
      claimResp = await ctx.http.request('POST', QODER_CHECKIN_CLAIM_URL, { headers, body: {}, timeout: 30000 })
    } catch { /* 沿用原响应做错误分类 */ }
  }

  const claimData = claimResp.data
  const result = claimData && (claimData.result || (claimData.data && claimData.data.result))

  if (result === 'CLAIMED' || (claimResp.status === 200 && !claimData.error && !claimData.errorCode)) {
    return {
      success: true, message: '签到成功',
      credits: (claimData && (claimData.reward_credits || claimData.rewardCredits)) || (claimData.data && (claimData.data.reward_credits || claimData.data.rewardCredits)) || 100,
      streakDays: (claimData && (claimData.current_streak_days || claimData.currentStreakDays)) || (claimData.data && (claimData.data.current_streak_days || claimData.data.currentStreakDays)),
    }
  }
  if (result === 'ALREADY_CLAIMED') return { success: true, message: '今日已签到' }

  const errMsg = (claimData && (claimData.message || claimData.error || claimData.errorMessage || claimData.errorCode || claimData.msg)) || ('HTTP ' + claimResp.status) || '签到失败'
  const message = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)
  if (isCampaignPending(claimResp, message)) {
    return { success: false, message, pending: true }
  }
  return { success: false, message }
}

async function run(ctx) {
  const accounts = ctx.env.parseEnvJson('QODER_CREDENTIALS')
  if (!accounts || !accounts.length) return []
  console.log('━'.repeat(60))
  console.log('🚀 Qoder 签到 - 共 ' + accounts.length + ' 个账号')
  console.log('━'.repeat(60))
  if (ctx.args.dryRun) {
    console.log('    [DRY-RUN] 将对 ' + accounts.length + ' 个账号执行签到，未发送任何请求')
    return []
  }
  const waitRounds = Math.min(envInt('QODER_WAIT', 0), 30)
  const maxRounds = 1 + waitRounds
  const results = []
  for (let i = 0; i < accounts.length; i++) {
    const cred = accounts[i]
    const name = cred.accountName || cred.email || cred.userId || ('Qoder账号' + (i + 1))
    console.log('\n  [' + (i + 1) + '/' + accounts.length + '] ' + name)
    try {
      let result
      for (let round = 1; round <= maxRounds; round++) {
        result = await qoderCheckin(cred, ctx)
        const pending = !!result.pending
        delete result.pending
        if (!pending || round === maxRounds) break
        console.log('    [Qoder] 本轮活动未下发，60 秒后重试 (' + round + '/' + waitRounds + ')...')
        await ctx.http.sleep(60000)
      }
      results.push({ platform: 'Qoder', name, ...result })
      const credits = result.credits != null ? ' (+' + result.credits + ' Credits)' : ''
      const streak = result.streakDays != null ? ' (连续' + result.streakDays + '天)' : ''
      console.log('    ' + (result.success ? '✅ ' : '❌ ') + result.message + credits + streak)
    } catch (e) {
      results.push({ platform: 'Qoder', name, success: false, message: e.message })
      console.log('    ❌ ' + ctx.http.truncate(e.message))
    }
    if (i < accounts.length - 1) await ctx.http.sleep(ctx.gapMs)
  }
  return results
}

module.exports = {
  name: 'Qoder',
  envs: ['QODER_CREDENTIALS'],
  detect: () => !!process.env.QODER_CREDENTIALS,
  run,
  qoderExchangeJobToken, isCampaignPending,
}
