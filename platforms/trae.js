/**
 * TRAE 签到（多账号）
 * 参考: baokun-l/trae-work-checkin + iicookies/auto-checkin
 *
 * P0 改进（借鉴 iicookies/auto-checkin）：
 *   1. 刷新后的 token/refreshToken/expiresAt/deviceId 原子写回本地令牌库
 *   2. 先查 checkin_credits/status（免费请求），已签到立即收手
 *   3. 统一 isAuthFail 判定；1001 时刷新一次再重试，不误报为「已领取」
 *   4. 9074 限流重试前再次复查状态，避免别的进程已签到还继续 claim
 */
'use strict'

const { atomicReadJSON, atomicWriteJSON, withLock, uidHash, statePath } = require('../lib/state')
const { isAuthFail, authFailMessage } = require('../lib/errors')

const TRAE_AUTH_HOST = 'https://api.trae.com.cn'
const TRAE_API_HOST = 'https://api.trae.cn'
const TRAE_CHECKIN_PATH = '/trae/api/v2/ug/checkin_credits/claim'
const TRAE_STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status'
const TRAE_REFRESH_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'
const TRAE_CLIENT_ID = 'en1oxy7wnw8j9n'
const TRAE_CLIENT_VERSION = '0.1.43'
const TRAE_REFRESH_THRESHOLD = 24 * 60 * 60 * 1000
const TRAE_STATE_FILE = 'trae_tokens.json'

/** 账号键必须基于稳定字段，不能用每次都变的 accessToken */
function accountKey(cred) {
  return uidHash(String(
    cred.accountName || cred.userId || cred.deviceId || cred.refreshToken || cred.token || ''
  ))
}

function buildHeaders(cred) {
  const deviceId = cred.deviceId || ''
  return {
    'Content-Type': 'application/json',
    Authorization: 'Cloud-IDE-JWT ' + cred.token,
    'x-device-id': deviceId,
    'X-Device-Id': deviceId,
    'X-User-Region': 'CN',
    'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION,
  }
}

async function loadSaved(ctx, cred, key) {
  const store = atomicReadJSON(statePath(ctx.stateDir, TRAE_STATE_FILE), { version: 1, accounts: {} })
  const saved = store && store.accounts && store.accounts[key]
  if (!saved) return cred
  return {
    ...cred,
    token: saved.token || cred.token,
    refreshToken: saved.refreshToken || cred.refreshToken,
    expiresAt: saved.expiresAt || cred.expiresAt,
    deviceId: saved.deviceId || cred.deviceId,
    userId: saved.userId || cred.userId,
  }
}

async function persist(ctx, cred, key) {
  const file = statePath(ctx.stateDir, TRAE_STATE_FILE)
  await withLock(file, async () => {
    const store = atomicReadJSON(file, { version: 1, accounts: {} }) || { version: 1, accounts: {} }
    if (!store.accounts) store.accounts = {}
    store.accounts[key] = {
      token: cred.token || '',
      refreshToken: cred.refreshToken || '',
      expiresAt: cred.expiresAt || 0,
      deviceId: cred.deviceId || '',
      userId: cred.userId || '',
      updatedAt: Date.now(),
    }
    atomicWriteJSON(file, store)
  })
}

async function traeRefreshCredential(cred, ctx) {
  const body = {
    ClientID: TRAE_CLIENT_ID,
    RefreshToken: cred.refreshToken,
    ClientSecret: '-',
    UserID: cred.userId || '',
  }
  const resp = await ctx.http.request('POST', TRAE_AUTH_HOST + TRAE_REFRESH_PATH, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION },
    body, timeout: 60000,
  })
  const result = resp.data && (resp.data.Result || resp.data.result || resp.data.data)
  if (!result || !result.Token) {
    const errMsg = resp.data && (resp.data.Message || resp.data.message || JSON.stringify(resp.data))
    throw new Error('TRAE Token 刷新失败: ' + ctx.http.truncate(errMsg))
  }
  let expiresAt = Number(result.TokenExpireAt || result.expiresAt || 0)
  if (expiresAt > 1e12) expiresAt = Math.floor(expiresAt / 1000)
  if (expiresAt < 1e10) expiresAt = expiresAt * 1000
  const boundDeviceId = result.BoundDeviceID || result.boundDeviceId || ''
  return {
    ...cred,
    token: result.Token,
    refreshToken: result.RefreshToken || result.refreshToken || cred.refreshToken,
    expiresAt: expiresAt || (Date.now() + 3600 * 1000),
    deviceId: boundDeviceId || cred.deviceId,
  }
}

async function traeEnsureValid(cred, ctx, key) {
  if (!cred.expiresAt || cred.expiresAt - Date.now() < TRAE_REFRESH_THRESHOLD) {
    console.log('    [TRAE] Token 刷新中...')
    try {
      const refreshed = await traeRefreshCredential(cred, ctx)
      await persist(ctx, refreshed, key)
      console.log('    [TRAE] Token 刷新成功（已写入令牌库）')
      return refreshed
    } catch (e) {
      // 区分明确拒绝与网络抖动：两者都先尝试用现有 AT 继续签到
      console.log('    [TRAE] 刷新失败，改用现有 token: ' + ctx.http.truncate(e.message, 100))
      return cred
    }
  }
  return cred
}

function traeApiSucceeded(data) {
  return data && (data.code === 0 || data.code === 200 || data.success === true || data.status === 'success')
}

function traeIsAlreadyCheckedIn(data) {
  const msg = (data && (data.message || data.msg)) || ''
  const lower = msg.toLowerCase()
  if (msg.includes('设备') || lower.includes('device') || lower.includes('machine')) return false
  // 注意：code=1001 是鉴权失败，由 isAuthFail 统一处理，绝不能当成「已领取」
  return data && (msg.includes('已签到') || msg.includes('已经签到') || msg.includes('明日再来') ||
    msg.includes('今日已完成') || msg.includes('已领取') ||
    lower.includes('already') || lower.includes('checked') || lower.includes('claimed'))
}

function traeCheckedIn(data) {
  if (!data || typeof data !== 'object') return false
  const d = data.data && typeof data.data === 'object' ? data.data : data
  return d.checked_in === true || d.checked_in === 1 || d.checkedIn === true
}

function creditsOf(data) {
  if (!data || typeof data !== 'object') return undefined
  const d = data.data && typeof data.data === 'object' ? data.data : data
  return d.credits || d.credit || d.points
}

async function traeCheckStatus(ctx, cred) {
  try {
    return await ctx.http.request('POST', TRAE_API_HOST + TRAE_STATUS_PATH, {
      headers: buildHeaders(cred), body: {}, timeout: 30000,
    })
  } catch {
    // 状态查询是「免费请求」，失败不应阻断后续 claim
    return { status: 0, data: null }
  }
}

async function traeCheckin(cred, ctx, key) {
  let validCred = await traeEnsureValid(cred, ctx, key)
  let headers = buildHeaders(validCred)

  // ① 状态预查：已签到立即收手，不消耗 claim 配额
  let st = await traeCheckStatus(ctx, validCred)
  if (isAuthFail(st)) {
    const refreshed = await traeRefreshCredential(validCred, ctx).catch(() => null)
    if (refreshed) {
      validCred = refreshed
      await persist(ctx, refreshed, key)
      headers = buildHeaders(validCred)
      st = await traeCheckStatus(ctx, validCred)
    }
    if (isAuthFail(st)) return { success: false, message: authFailMessage(st) }
  }
  if (traeCheckedIn(st && st.data)) {
    return { success: true, message: '今日已签到', points: creditsOf(st && st.data) }
  }

  // ② 领取（9074 限流重试；重试前复查状态；1001 刷新一次后重试）
  let lastResp
  let authRetried = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      const st2 = await traeCheckStatus(ctx, validCred)
      if (traeCheckedIn(st2 && st2.data)) {
        return { success: true, message: '今日已签到', points: creditsOf(st2 && st2.data) }
      }
    }
    const resp = await ctx.http.request('POST', TRAE_API_HOST + TRAE_CHECKIN_PATH, {
      headers, body: {}, timeout: 30000,
    })
    lastResp = resp
    const data = resp.data
    if (data && data.code === 9074 && attempt < 3) {
      const wait = 20 * attempt
      console.log('    [TRAE] 服务端限流(9074)，' + wait + '秒后重试(' + attempt + '/3)...')
      await ctx.http.sleep(wait * 1000)
      continue
    }
    if (isAuthFail(resp) && !authRetried) {
      authRetried = true
      const refreshed = await traeRefreshCredential(validCred, ctx).catch(() => null)
      if (refreshed) {
        validCred = refreshed
        await persist(ctx, refreshed, key)
        headers = buildHeaders(validCred)
        attempt--
        continue
      }
      return { success: false, message: authFailMessage(resp) }
    }
    if (traeApiSucceeded(data)) {
      const msg = (data.message === 'success' || data.msg === 'success') ? '签到成功' : (data.message || data.msg || '签到成功')
      return { success: true, message: msg, points: (data.data && data.data.points) || data.points || 200 }
    }
    if (traeIsAlreadyCheckedIn(data)) return { success: true, message: '今日已签到' }
    break
  }
  const data = lastResp && lastResp.data
  return { success: false, message: (data && (data.message || data.msg)) || ('HTTP ' + (lastResp && lastResp.status)) || '签到失败' }
}

async function run(ctx) {
  const accounts = ctx.env.parseEnvJson('TRAE_CREDENTIALS')
  if (!accounts || !accounts.length) return []
  console.log('━'.repeat(60))
  console.log('🚀 TRAE 签到 - 共 ' + accounts.length + ' 个账号')
  console.log('━'.repeat(60))
  if (ctx.args.dryRun) {
    console.log('    [DRY-RUN] 将对 ' + accounts.length + ' 个账号执行签到，未发送任何请求')
    return []
  }
  const results = []
  for (let i = 0; i < accounts.length; i++) {
    const cred = accounts[i]
    const key = accountKey(cred)
    const name = cred.accountName || cred.userId || ('TRAE账号' + (i + 1))
    console.log('\n  [' + (i + 1) + '/' + accounts.length + '] ' + name)
    try {
      const merged = await loadSaved(ctx, cred, key)
      const result = await traeCheckin(merged, ctx, key)
      results.push({ platform: 'TRAE', name, ...result })
      const pts = result.points ? ' (+' + result.points + '积分)' : ''
      console.log('    ✅ ' + result.message + pts)
    } catch (e) {
      results.push({ platform: 'TRAE', name, success: false, message: e.message })
      console.log('    ❌ ' + ctx.http.truncate(e.message))
    }
    if (i < accounts.length - 1) await ctx.http.sleep(ctx.gapMs)
  }
  return results
}

module.exports = {
  name: 'TRAE',
  envs: ['TRAE_CREDENTIALS'],
  detect: () => !!process.env.TRAE_CREDENTIALS,
  run,
  accountKey, traeCheckedIn, traeCheckStatus,
}
