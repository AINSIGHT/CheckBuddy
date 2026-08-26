/**
 * 三合一签到脚本 - TRAE + WorkBuddy + Qoder 每日签到（青龙面板版）
 *
 * @cron 30 8 * * *
 * @author ai-checkin
 *
 * 融合自多个开源项目：
 *   - trae-check              https://github.com/inlayin/trae-check
 *   - workbuddy-checkin        https://github.com/LiuKay/workbuddy-checkin
 *   - baokun-l/trae-work-checkin  https://github.com/baokun-l/trae-work-checkin
 *   - iicookies/auto-checkin     https://github.com/iicookies/auto-checkin
 *   - pi-provider-qoder          https://github.com/simonsmh/pi-provider-qoder
 *
 * ==================== 环境变量（全部可选，配哪个签哪个） ====================
 * TRAE_CREDENTIALS       TRAE 桌面端凭证 JSON（单账号对象或多账号数组）
 * WORKBUDDY_CREDENTIALS  WorkBuddy 凭证 JSON（单账号对象或多账号数组）
 * QODER_CREDENTIALS      Qoder 凭证 JSON（单账号对象或多账号数组）
 *
 * ==================== 青龙使用方式 ====================
 * 1. 订阅本仓库（或手动放入青龙 scripts 目录）
 * 2. 在「环境变量」中添加上述变量（至少一个）
 * 3. 定时任务命令: task checkin_all.js，建议 cron: 30 8 * * *
 *
 * ==================== Token 刷新机制 ====================
 * TRAE:   简化 ExchangeToken，无需 RSA 签名（参考 baokun-l + iicookies）
 *         端点: POST https://api.trae.com.cn/cloudide/api/v3/trae/oauth/ExchangeToken
 *         签到: POST https://api.trae.cn/trae/api/v2/ug/checkin_credits/claim
 * Qoder:  PAT → job token 自动交换（参考 pi-provider-qoder）
 *         端点: POST https://openapi.qoder.com.cn/api/v1/jobToken/exchange
 *         签到: POST https://openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/claim
 */

'use strict'

const crypto = require('crypto')
const https = require('https')
const http = require('http')
const os = require('os')

// ====================================================================
//  通用 HTTP 工具
// ====================================================================
function httpRequest(method, url, { headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const lib = urlObj.protocol === 'https:' ? https : http
    const postData = body !== null ? JSON.stringify(body) : null
    const reqHeaders = { ...headers }
    if (postData) reqHeaders['Content-Type'] = 'application/json'
    const options = {
      method, hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search, headers: reqHeaders, timeout,
    }
    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('请求超时: ' + url)))
    if (postData) req.write(postData)
    req.end()
  })
}

async function sendNotify(title, content) {
  console.log('\n' + '='.repeat(60))
  console.log('📢 ' + title)
  console.log('='.repeat(60))
  console.log(content)
  console.log('='.repeat(60) + '\n')
  const notifyPaths = ['./sendNotify', './notify', '../sendNotify']
  for (const p of notifyPaths) {
    try {
      const notify = require(p)
      if (typeof notify.sendNotify === 'function') { await notify.sendNotify(title, content); return }
      if (typeof notify === 'function') { await notify(title, content); return }
    } catch {}
  }
}

function truncate(str, max = 200) {
  if (typeof str !== 'string') str = JSON.stringify(str)
  return str.length > max ? str.substring(0, max) + '...' : str
}

function parseEnvJson(envName) {
  const raw = process.env[envName]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    throw new Error(envName + ' 不是合法的 JSON')
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ###################################################################
//                    第一部分：TRAE 签到（多账号）
// 参考: baokun-l/trae-work-checkin + iicookies/auto-checkin
// ###################################################################

const TRAE_AUTH_HOST = 'https://api.trae.com.cn'   // 认证 API
const TRAE_API_HOST = 'https://api.trae.cn'         // 签到/积分 API
const TRAE_CHECKIN_PATH = '/trae/api/v2/ug/checkin_credits/claim'
const TRAE_STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status'
const TRAE_REFRESH_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'
const TRAE_CLIENT_ID = 'en1oxy7wnw8j9n'
const TRAE_CLIENT_VERSION = '0.1.43'
const TRAE_REFRESH_THRESHOLD = 24 * 60 * 60 * 1000 // 24 小时前刷新

/**
 * TRAE Token 刷新（简化版，无需 RSA 签名和 DeviceInfo）
 * 参考 baokun-l/trae-work-checkin 和 iicookies/auto-checkin
 * 端点: POST https://api.trae.com.cn/cloudide/api/v3/trae/oauth/ExchangeToken
 * Body: { ClientID, RefreshToken, ClientSecret: "-", UserID }
 * Response: { Result: { Token, RefreshToken, TokenExpireAt, BoundDeviceID } }
 */
async function traeRefreshCredential(cred) {
  const body = {
    ClientID: TRAE_CLIENT_ID,
    RefreshToken: cred.refreshToken,
    ClientSecret: '-',
    UserID: cred.userId || '',
  }
  const resp = await httpRequest('POST', TRAE_AUTH_HOST + TRAE_REFRESH_PATH, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION },
    body, timeout: 60000,
  })
  const result = resp.data && (resp.data.Result || resp.data.result || resp.data.data)
  if (!result || !result.Token) {
    const errMsg = resp.data && (resp.data.Message || resp.data.message || JSON.stringify(resp.data))
    throw new Error('TRAE Token 刷新失败: ' + truncate(errMsg))
  }
  // TokenExpireAt 可能是毫秒时间戳
  let expiresAt = Number(result.TokenExpireAt || result.expiresAt || 0)
  if (expiresAt > 1e12) expiresAt = Math.floor(expiresAt / 1000) // 转秒
  if (expiresAt < 1e10) expiresAt = expiresAt * 1000 // 如果是秒级，转毫秒
  // BoundDeviceID: 刷新返回的设备 ID，用于签到
  const boundDeviceId = result.BoundDeviceID || result.boundDeviceId || ''
  return {
    ...cred,
    token: result.Token,
    refreshToken: result.RefreshToken || result.refreshToken || cred.refreshToken,
    expiresAt: expiresAt || (Date.now() + 3600 * 1000),
    // 优先使用 BoundDeviceID，否则保留原 deviceId
    deviceId: boundDeviceId || cred.deviceId,
  }
}

async function traeEnsureValid(cred) {
  // 如果没有过期时间或即将过期（24小时内），刷新
  if (!cred.expiresAt || cred.expiresAt - Date.now() < TRAE_REFRESH_THRESHOLD) {
    console.log('    [TRAE] Token 刷新中...')
    const refreshed = await traeRefreshCredential(cred)
    console.log('    [TRAE] Token 刷新成功')
    return refreshed
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
  return data && (data.code === 1001 ||
    msg.includes('已签到') || msg.includes('已经签到') || msg.includes('明日再来') ||
    msg.includes('今日已完成') || msg.includes('已领取') ||
    lower.includes('already') || lower.includes('checked') || lower.includes('claimed'))
}

async function traeCheckin(cred) {
  const validCred = await traeEnsureValid(cred)
  // 设备 ID: 优先用 BoundDeviceID (刷新返回)，否则用 machineid
  const deviceId = validCred.deviceId || ''
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Cloud-IDE-JWT ' + validCred.token,
    'x-device-id': deviceId,
    'X-Device-Id': deviceId,
    'X-User-Region': 'CN',
    'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION,
  }

  // 服务端可能限流返回 9074，重试 3 次
  let lastResp
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await httpRequest('POST', TRAE_API_HOST + TRAE_CHECKIN_PATH, {
      headers, body: {}, timeout: 30000,
    })
    lastResp = resp
    const data = resp.data
    if (data && data.code === 9074 && attempt < 3) {
      const wait = 20 * attempt
      console.log('    [TRAE] 服务端限流(9074)，' + wait + '秒后重试(' + attempt + '/3)...')
      await sleep(wait * 1000)
      continue
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

async function runTraeCheckin(results) {
  const accounts = parseEnvJson('TRAE_CREDENTIALS')
  if (!accounts) return
  console.log('━'.repeat(60))
  console.log('🚀 TRAE 签到 - 共 ' + accounts.length + ' 个账号')
  console.log('━'.repeat(60))
  for (let i = 0; i < accounts.length; i++) {
    const cred = accounts[i]
    const name = cred.accountName || cred.userId || ('TRAE账号' + (i + 1))
    console.log('\n  [' + (i + 1) + '/' + accounts.length + '] ' + name)
    try {
      const result = await traeCheckin(cred)
      results.push({ platform: 'TRAE', name, ...result })
      const pts = result.points ? ' (+' + result.points + '积分)' : ''
      console.log('    ✅ ' + result.message + pts)
    } catch (e) {
      results.push({ platform: 'TRAE', name, success: false, message: e.message })
      console.log('    ❌ ' + truncate(e.message))
    }
    if (i < accounts.length - 1) await sleep(3000)
  }
}

// ###################################################################
//                  第二部分：WorkBuddy 签到（多账号）
// ###################################################################

const WB_BASE_URL = 'https://www.codebuddy.cn'
const WB_CHECKIN_URL = WB_BASE_URL + '/v2/billing/meter/daily-checkin'
const WB_STATUS_PATHS = ['/v2/billing/meter/checkin-activity-status', '/v2/billing/meter/checkin-status']

function wbBuildHeaders(cred) {
  const headers = { Authorization: 'Bearer ' + cred.token, Accept: 'application/json', 'Content-Type': 'application/json' }
  if (cred.uid) headers['X-User-Id'] = cred.uid
  if (cred.enterprise_id) { headers['X-Enterprise-Id'] = cred.enterprise_id; headers['X-Tenant-Id'] = cred.enterprise_id }
  if (cred.domain) headers['X-Domain'] = cred.domain
  return headers
}

async function wbRequest(url, headers) {
  const resp = await httpRequest('POST', url, { headers, body: {}, timeout: 30000 })
  if (resp.status >= 400) throw new Error((resp.data && (resp.data.message || resp.data.msg)) || ('HTTP ' + resp.status))
  if (!resp.data || typeof resp.data !== 'object') throw new Error('WorkBuddy 返回了无效 JSON')
  return resp.data
}

function wbCheckedState(data) {
  const value = data && (data.today_checked_in != null ? data.today_checked_in : data.todayCheckedIn)
  if (value === undefined || value === null) return null
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true' || lower === '1') return true
    if (lower === 'false' || lower === '0') return false
  }
  return null
}

async function wbGetCheckinStatus(headers) {
  for (const path of WB_STATUS_PATHS) {
    try {
      const body = await wbRequest(WB_BASE_URL + path, headers)
      const data = body && body.data
      if (body && body.code === 0 && data && typeof data === 'object' && wbCheckedState(data) !== null) return data
    } catch {}
  }
  return null
}

function wbParseResponse(body) {
  if (!body || body.code !== 0) throw new Error((body && (body.message || body.msg)) || '签到失败')
  const data = body && body.data
  if (!data || typeof data !== 'object') throw new Error('WorkBuddy 响应缺少 data 字段')
  return {
    success: data.success !== false,
    message: data.message || body.message || '签到成功',
    credit: data.credit != null ? data.credit : (data.today_credit || data.todayCredit || data.daily_credit),
    streakDays: data.streak_days != null ? data.streak_days : data.streakDays,
  }
}

async function wbCheckin(cred) {
  const headers = wbBuildHeaders(cred)
  const status = await wbGetCheckinStatus(headers)
  if (status && wbCheckedState(status) === true) {
    return {
      success: true, message: '今日已签到',
      credit: status.today_credit || status.todayCredit || status.daily_credit || status.dailyCredit,
      streakDays: status.streak_days || status.streakDays,
    }
  }
  return wbParseResponse(await wbRequest(WB_CHECKIN_URL, headers))
}

async function runWorkBuddyCheckin(results) {
  const accounts = parseEnvJson('WORKBUDDY_CREDENTIALS')
  if (!accounts) return
  console.log('━'.repeat(60))
  console.log('🚀 WorkBuddy 签到 - 共 ' + accounts.length + ' 个账号')
  console.log('━'.repeat(60))
  for (let i = 0; i < accounts.length; i++) {
    const cred = accounts[i]
    const name = cred.uid ? ('WorkBuddy(' + cred.uid + ')') : ('WorkBuddy账号' + (i + 1))
    console.log('\n  [' + (i + 1) + '/' + accounts.length + '] ' + name)
    try {
      const result = await wbCheckin(cred)
      results.push({ platform: 'WorkBuddy', name, ...result })
      const credit = result.credit != null ? ' (+' + result.credit + '积分)' : ''
      const streak = result.streakDays != null ? ' (连续' + result.streakDays + '天)' : ''
      console.log('    ✅ ' + result.message + credit + streak)
    } catch (e) {
      results.push({ platform: 'WorkBuddy', name, success: false, message: e.message })
      console.log('    ❌ ' + truncate(e.message))
    }
    if (i < accounts.length - 1) await sleep(3000)
  }
}

// ###################################################################
//                    第三部分：Qoder 签到（多账号）
// ###################################################################

const QODER_API_BASE = 'https://openapi.qoder.com.cn'
const QODER_CHECKIN_STATUS_URL = QODER_API_BASE + '/sash/api/v1/me/daily-check-in/status'
const QODER_CHECKIN_CLAIM_URL = QODER_API_BASE + '/sash/api/v1/me/daily-check-in/claim'
const QODER_PAT_EXCHANGE_URL = QODER_API_BASE + '/api/v1/jobToken/exchange'
const QODER_REFRESH_THRESHOLD = 60 * 60 * 1000 // 1 小时内刷新

/**
 * 交换 PAT 为 job token（参考 pi-provider-qoder/src/pat.ts）
 * PAT (pt-...) 不能直接调 API，需要交换为短期 job token (jt-...)
 * 交换端点不需要 COSY 签名，只需 Cosy-Version 和 Cosy-ClientType
 */
async function qoderExchangeJobToken(pat) {
  const resp = await httpRequest('POST', QODER_PAT_EXCHANGE_URL, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Cosy-Version': '1.0.1',
      'Cosy-ClientType': '5',
    },
    body: { personal_token: pat },
    timeout: 30000,
  })
  const data = resp.data
  if (!data || !data.token) {
    const errMsg = (data && (data.message || data.error)) || 'PAT 交换失败'
    throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg))
  }
  let expiresAt = Date.now() + 24 * 60 * 60 * 1000
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at)
    if (!isNaN(parsed)) expiresAt = parsed
  } else if (data.expires_in) {
    expiresAt = Date.now() + data.expires_in
  }
  return {
    jobToken: data.token,
    jobRefreshToken: data.refresh_token || '',
    expiresAt: expiresAt,
  }
}

/**
 * 构建 Qoder 请求 headers（参考 pi-provider-qoder/src/cosy.ts）
 * 签到 API (/sash/) 使用简单 Bearer 认证
 * 模型 API (/algo/) 需要 COSY 签名，但签到不需要
 */
function buildQoderHeaders(jobToken) {
  return {
    Authorization: 'Bearer ' + jobToken,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Cosy-Version': '1.0.1',
    'Cosy-ClientType': '5',
  }
}

/**
 * 确保 Qoder token 有效
 * 优先使用 PAT 交换 job token（每次签到前自动交换，无需手动刷新）
 * 如果没有 PAT，直接使用存储的 token（兼容旧格式）
 */
async function qoderEnsureValid(cred) {
  // 如果有 PAT，每次都重新交换（job token 短期有效，重新交换最可靠）
  if (cred.pat) {
    console.log('    [Qoder] 使用 PAT 交换 job token...')
    try {
      const result = await qoderExchangeJobToken(cred.pat)
      console.log('    [Qoder] PAT 交换成功, job token 有效至 ' + new Date(result.expiresAt).toISOString())
      return { ...cred, token: result.jobToken, refreshToken: result.jobRefreshToken, expiresAt: result.expiresAt }
    } catch (e) {
      console.log('    [Qoder] PAT 交换失败: ' + e.message)
      // 如果 PAT 交换失败，尝试用已有的 token
      if (cred.token) {
        console.log('    [Qoder] 回退到已有 token...')
        return cred
      }
      throw e
    }
  }
  // 无 PAT，直接用存储的 token
  return cred
}

/**
 * 执行单个 Qoder 账号签到
 */
async function qoderCheckin(cred) {
  const validCred = await qoderEnsureValid(cred)
  const headers = buildQoderHeaders(validCred.token)

  // 查询签到状态
  let statusResp
  try {
    statusResp = await httpRequest('GET', QODER_CHECKIN_STATUS_URL, { headers, timeout: 30000 })
  } catch (e) {
    // 状态查询失败，直接尝试签到
  }

  const statusData = statusResp && statusResp.data
  const status = statusData && statusData.status

  if (status === 'CLAIMED_TODAY') {
    return {
      success: true,
      message: '今日已签到',
      credits: statusData.reward_credits || statusData.rewardCredits,
      streakDays: statusData.current_streak_days || statusData.currentStreakDays,
    }
  }

  // 执行签到领取
  let claimResp = await httpRequest('POST', QODER_CHECKIN_CLAIM_URL, { headers, body: {}, timeout: 30000 })
  let claimData = claimResp.data

  const result = claimData && (claimData.result || (claimData.data && claimData.data.result))

  if (result === 'CLAIMED' || (claimResp.status === 200 && !claimData.error)) {
    return {
      success: true,
      message: '签到成功',
      credits: (claimData && (claimData.reward_credits || claimData.rewardCredits)) || (claimData.data && (claimData.data.reward_credits || claimData.data.rewardCredits)) || 100,
      streakDays: (claimData && (claimData.current_streak_days || claimData.currentStreakDays)) || (claimData.data && (claimData.data.current_streak_days || claimData.data.currentStreakDays)),
    }
  }

  if (result === 'ALREADY_CLAIMED') {
    return { success: true, message: '今日已签到' }
  }

  const errMsg = (claimData && (claimData.message || claimData.error || claimData.msg)) || ('HTTP ' + claimResp.status) || '签到失败'
  return { success: false, message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) }
}

/**
 * Qoder 签到入口：处理所有 Qoder 账号
 */
async function runQoderCheckin(results) {
  const accounts = parseEnvJson('QODER_CREDENTIALS')
  if (!accounts) return
  console.log('━'.repeat(60))
  console.log('🚀 Qoder 签到 - 共 ' + accounts.length + ' 个账号')
  console.log('━'.repeat(60))
  for (let i = 0; i < accounts.length; i++) {
    const cred = accounts[i]
    const name = cred.accountName || cred.email || cred.userId || ('Qoder账号' + (i + 1))
    console.log('\n  [' + (i + 1) + '/' + accounts.length + '] ' + name)
    try {
      const result = await qoderCheckin(cred)
      results.push({ platform: 'Qoder', name, ...result })
      const credits = result.credits != null ? ' (+' + result.credits + ' Credits)' : ''
      const streak = result.streakDays != null ? ' (连续' + result.streakDays + '天)' : ''
      console.log('    ✅ ' + result.message + credits + streak)
    } catch (e) {
      results.push({ platform: 'Qoder', name, success: false, message: e.message })
      console.log('    ❌ ' + truncate(e.message))
    }
    if (i < accounts.length - 1) await sleep(3000)
  }
}

// ###################################################################
//                      第四部分：主流程
// ###################################################################

async function main() {
  console.log('🔔 三合一签到脚本 - TRAE + WorkBuddy + Qoder')
  console.log('⏰ 执行时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))
  console.log()

  const hasTrae = !!process.env.TRAE_CREDENTIALS
  const hasWorkBuddy = !!process.env.WORKBUDDY_CREDENTIALS
  const hasQoder = !!process.env.QODER_CREDENTIALS

  if (!hasTrae && !hasWorkBuddy && !hasQoder) {
    await sendNotify('三合一签到 - 配置错误', '未设置任何环境变量\n请至少配置 TRAE_CREDENTIALS / WORKBUDDY_CREDENTIALS / QODER_CREDENTIALS 之一')
    process.exit(1)
  }

  const results = []

  if (hasTrae) {
    try { await runTraeCheckin(results) } catch (e) { console.log('\n  ⚠️ TRAE 签到整体异常: ' + truncate(e.message)) }
    console.log()
  }

  if (hasWorkBuddy) {
    try { await runWorkBuddyCheckin(results) } catch (e) { console.log('\n  ⚠️ WorkBuddy 签到整体异常: ' + truncate(e.message)) }
    console.log()
  }

  if (hasQoder) {
    try { await runQoderCheckin(results) } catch (e) { console.log('\n  ⚠️ Qoder 签到整体异常: ' + truncate(e.message)) }
    console.log()
  }

  // 汇总
  const successList = results.filter((r) => r.success && r.message !== '今日已签到')
  const alreadyList = results.filter((r) => r.success && r.message === '今日已签到')
  const failList = results.filter((r) => !r.success)

  const lines = results.map((r) => {
    const icon = r.success ? '✅' : '❌'
    const pts = r.points ? ' (+' + r.points + ')' : (r.credit != null ? ' (+' + r.credit + ')' : (r.credits != null ? ' (+' + r.credits + ' Credits)' : ''))
    const streak = r.streakDays != null ? ' 连' + r.streakDays + '天' : ''
    return icon + ' [' + r.platform + '] ' + r.name + ': ' + r.message + pts + streak
  })

  const summary =
    '📊 三合一签到汇总 (' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ')\n\n' +
    lines.join('\n') +
    '\n\n成功: ' + successList.length + ' | 已签: ' + alreadyList.length + ' | 失败: ' + failList.length

  console.log(summary)

  if (failList.length > 0) {
    await sendNotify('三合一签到 - ' + failList.length + ' 个失败', summary)
  } else if (successList.length > 0) {
    await sendNotify('三合一签到 - 全部成功', summary)
  }

  process.exit(failList.length > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('💥 脚本异常:', e)
  await sendNotify('三合一签到 - 脚本异常', String(e.message || e))
  process.exit(1)
})
