/**
 * 统一的鉴权失败判定。
 *
 * 参考 iicookies/auto-checkin 的 is_auth_fail()：业务码 1001 或 HTTP 401/403
 * 都属于登录态失效。关键是 1001 不能被当成「今日已签到/已领取」——
 * 上游 TRAE 在 token 失效时返回 1001 "not able to authenticate"，
 * 若误判成已领取会掩盖真实失败。
 */
'use strict'

function isAuthFail(resp) {
  if (!resp) return false
  if (resp.status === 401 || resp.status === 403) return true
  const d = resp.data
  if (!d || typeof d !== 'object') return false
  const code = d.code
  return code === 1001 || code === '1001' || code === 401 || code === 403 || code === 40100
}

function authFailMessage(resp, prefix = '认证失败，无法确认领取状态') {
  const d = resp && resp.data
  const detail = d && (d.message || d.msg || d.errorMessage || d.errorCode)
  return prefix + (detail ? ' (' + String(detail).slice(0, 80) + ')' : '')
}

module.exports = { isAuthFail, authFailMessage }
