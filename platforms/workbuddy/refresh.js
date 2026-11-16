/**
 * WorkBuddy 令牌续期（RT 轮换永续）
 * 四个要点：头对齐、新旧 RT 必写回、原子写 + 文件锁、TLS 校验保持开启。
 */
'use strict'

const crypto = require('crypto')
const { envStr } = require('../../lib/env')
const creds = require('./credentials')

const TEN_DAYS = 10 * 24 * 60 * 60 * 1000
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

/**
 * 统一的刷新请求头：登录工具与主脚本共用此函数，避免同一端点出现两套指纹。
 * 有 AT / uid 时带全套身份头；缺失时退回纯 RT 形态，不伪造身份。
 */
function buildRefreshHeaders(account) {
  const headers = {
    'X-Refresh-Token': account.rt,
    'X-Auth-Refresh-Source': 'plugin',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: creds.WB_ORIGIN,
    Referer: creds.WB_ORIGIN + '/',
    'User-Agent': creds.WB_UA,
    'X-Request-ID': crypto.randomBytes(16).toString('hex'),
  }
  if (account.at) headers.Authorization = 'Bearer ' + account.at
  if (account.uid) headers['X-User-Id'] = String(account.uid)
  headers['X-Domain'] = envStr('WB_X_DOMAIN', account.domain || 'www.workbuddy.cn')
  return headers
}

function needRefresh(account, { force = false } = {}) {
  if (!account.rt) return false
  if (force) return true
  if (!account.at) return true
  const now = Date.now()
  if (account.expiresAt && account.expiresAt - now < SEVEN_DAYS) return true
  if (!account.lastRefresh || now - account.lastRefresh > TEN_DAYS) return true
  return false
}

/** 刷新并把轮换后的 AT/RT 立即原子写回令牌库；失败时保留旧 RT 不动 */
async function refreshAccount(ctx, account, { force = false } = {}) {
  if (!account.rt) return { ok: false, message: '无 refresh token，跳过续期' }
  const oldRt = account.rt
  try {
    const resp = await ctx.http.requestWithRetry('POST', creds.WB_REFRESH_URL, {
      headers: buildRefreshHeaders(account), body: {}, timeout: 30000,
    }, { retries: 1, delays: [2000] })

    const d = resp.data
    const newAt = d && d.data && (d.data.accessToken || d.data.access_token)
    if (resp.status >= 400 || !d || (d.code !== 0 && d.code !== 200) || !newAt) {
      const msg = (d && (d.msg || d.message)) || ('HTTP ' + resp.status)
      return { ok: false, message: '续期失败: ' + ctx.http.truncate(msg, 120) }
    }
    const newRt = (d.data.refreshToken || d.data.refresh_token || account.rt)
    const jwt = creds.decodeJwt(newAt)
    account.at = newAt
    account.rt = newRt
    account.lastRefresh = Date.now()
    account.expiresAt = jwt && jwt.exp ? jwt.exp * 1000 : 0
    account.refreshable = true
    await creds.persistAccount(ctx, account)
    return {
      ok: true,
      rotated: newRt !== oldRt,
      message: '续期成功' + (jwt && jwt.exp ? '，AT 有效至 ' + new Date(jwt.exp * 1000).toISOString().slice(0, 10) : ''),
    }
  } catch (e) {
    return { ok: false, message: '续期异常: ' + ctx.http.truncate(e.message, 120) }
  }
}

module.exports = { buildRefreshHeaders, needRefresh, refreshAccount }
