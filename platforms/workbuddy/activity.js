/**
 * 签到后的活跃计分确认（默认关闭，需 WB_ACTIVITY_CONFIRM=1 或 --activity-confirm）。
 * 补发 chat_request_send 事件后回读热力图 score，未计分只提示、不影响签到结果。
 */
'use strict'

const crypto = require('crypto')
const creds = require('./credentials')
const { envBool } = require('../../lib/env')

function enabled(ctx) {
  return !!(ctx.args.activityConfirm || envBool('WB_ACTIVITY_CONFIRM'))
}

function headers(account) {
  return creds.buildHeaders(account, {
    'X-Domain': 'copilot.tencent.com',
    'X-Request-ID': crypto.randomBytes(16).toString('hex'),
  })
}

async function confirmActivity(ctx, account) {
  if (!enabled(ctx)) return { enabled: false, details: [] }
  const base = creds.baseUrls()[0]
  const details = []
  try {
    const resp = await ctx.http.request('POST', base + '/v2/report', {
      headers: headers(account),
      body: [{
        event: 'chat_request_send',
        timestamp: Date.now(),
        properties: { source: 'workbuddy-daily-checkin', client_platform: 'web' },
      }],
      timeout: 20000,
    })
    if (resp.status >= 400) details.push('活跃事件上报返回 HTTP ' + resp.status)
  } catch (e) {
    details.push('活跃事件上报失败: ' + ctx.http.truncate(e.message, 80))
  }
  try {
    const resp = await ctx.http.request('GET', base + '/v2/activity/growth/heatmap', {
      headers: creds.buildHeaders(account), body: null, timeout: 20000,
    })
    const d = resp.data && resp.data.data ? resp.data.data : resp.data
    const score = d && (d.score != null ? d.score : d.today_score)
    if (score != null) {
      details.push(Number(score) > 0 ? '✅ 热力图已计分 (score=' + score + ')' : '⚠️ 热力图 score=0，本轮未计分，下轮继续尝试')
    }
  } catch (e) {
    details.push('热力图回读失败: ' + ctx.http.truncate(e.message, 80))
  }
  return { enabled: true, details }
}

module.exports = { enabled, confirmActivity }
