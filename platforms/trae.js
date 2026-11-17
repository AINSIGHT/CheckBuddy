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

const crypto = require('crypto')
const os = require('os')
const { atomicReadJSON, atomicWriteJSON, withLock, uidHash, statePath } = require('../lib/state')
const { isAuthFail, authFailMessage } = require('../lib/errors')

const TRAE_AUTH_HOST = 'https://api.trae.com.cn'
const TRAE_API_HOST = 'https://api.trae.cn'
const TRAE_CHECKIN_PATH = '/trae/api/v2/ug/checkin_credits/claim'
const TRAE_STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status'
const TRAE_REFRESH_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'
// 新版续期端点：必须带设备证明（DeviceProof + DeviceInfo），缺了返回 20405 Device proof required
const TRAE_REFRESH_PROOF_PATH = '/trae/api/v3/oauth/ExchangeToken'
const TRAE_CLIENT_VERSION = '1.107.1'
const TRAE_REFRESH_THRESHOLD = 24 * 60 * 60 * 1000
const TRAE_STATE_FILE = 'trae_tokens.json'
// 真机 Aha 设备号是十进制数字，15/16 位都有（上游 v1.1 已修正「必须 16 位」的误判）
const TRAE_DEVICE_ID_RE = /^\d{12,20}$/

// req_source 必须与 token 谱系匹配：IDE=1 / SOLO=2；缺失或错配都会被拒成 9074
const TRAE_PROFILES = [
  { name: 'IDE', clientId: 'ono9krqynydwx5', reqSource: 1, platformCode: 'IDE_PC' },
  { name: 'SOLO', clientId: 'en1oxy7wnw8j9n', reqSource: 2, platformCode: 'SOLO_PC' },
]

/** UUID/32 位 hex/空值都不是真设备号；自造数字同样会 9074 */
function isAhaDeviceId(id) {
  return TRAE_DEVICE_ID_RE.test(String(id || '').trim())
}

/** 显式配置优先；否则 IDE → SOLO 依次尝试，兼容两种客户端导出的 token */
function traeProfiles(cred) {
  const clientId = String((cred && cred.clientId) || process.env.TRAE_CLIENT_ID || '').trim()
  const reqSource = Number((cred && cred.reqSource) || process.env.TRAE_REQ_SOURCE || 0)
  if (clientId || reqSource) {
    return [{
      name: 'custom',
      clientId: clientId || TRAE_PROFILES[0].clientId,
      reqSource: reqSource || TRAE_PROFILES[0].reqSource,
    }]
  }
  return TRAE_PROFILES
}

function reqSourceOf(cred) {
  const fromCred = Number(cred && cred.reqSource)
  if (fromCred) return fromCred
  return traeProfiles(cred)[0].reqSource
}

/** 服务端明确拒绝 RT（20101 / invalid refresh token），用于区别于网络抖动 */
function isRefreshRejected(message) {
  return /20101|refresh\s*token\s*is\s*invalid|invalid\s*refresh\s*token|refresh.?token.*(expired|invalid)/i.test(String(message || ''))
}

/** 把续期错误码翻译成可执行的修复动作（上游实测对照表） */
function traeRefreshHint(message) {
  const m = String(message || '')
  if (/20405/.test(m)) return '；服务端要求设备证明(20405)：重新运行 npm run extract / save:creds 生成含 privateKeyPEM 的完整凭证，或配置 TRAE_DEVICE_KEY_PEM / TRAE_DEVICE_PUB_PEM / TRAE_DEVICE_ID 环境变量'
  if (/20403/.test(m)) return '；设备与 token 不匹配(20403)：设备密钥必须来自签发该 token 的同一台机器的客户端'
  if (/10101/.test(m)) return '；RT 与客户端不匹配(10101)：可能被别处轮换过，或来自另一条产品线（TRAE SOLO 与 Trae IDE 不通用）'
  return ''
}

/**
 * 新版续期设备证明材料。优先级：账号凭证 JSON 字段（npm run extract 已导出
 * privateKeyPEM/publicKeyPEM）> 环境变量（TRAE_DEVICE_KEY_PEM 等，青龙/Actions 用）。
 * 注意：密钥必须来自客户端（与服务端登记的设备公钥一致），自造密钥对会 20403。
 */
function traeDeviceKeys(cred) {
  const pem = (v) => String(v || '').replace(/\\n/g, '\n').trim()
  const privateKeyPem = pem((cred && cred.privateKeyPEM) || process.env.TRAE_DEVICE_KEY_PEM)
  const publicKeyPem = pem((cred && cred.publicKeyPEM) || process.env.TRAE_DEVICE_PUB_PEM)
  const deviceId = String((cred && (cred.deviceId || cred.device_id)) || process.env.TRAE_DEVICE_ID || '').trim()
  if (!privateKeyPem || !publicKeyPem || !deviceId) return null
  return {
    privateKeyPem, publicKeyPem, deviceId,
    machineId: String((cred && cred.machineId) || process.env.TRAE_MACHINE_ID || '').trim(),
  }
}

/** ECDSA P-256 / SHA-256 → base64(DER)，低 s 归一化（与官方客户端一致） */
function ecSignLowS(privateKeyPem, data) {
  const sig = crypto.sign('sha256', data, { key: privateKeyPem, dsaEncoding: 'der' })
  try {
    const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
    let i = 2 // 跳过 SEQUENCE 头（签名总长 < 128，长度必然单字节）
    const readInt = () => {
      if (sig[i++] !== 0x02) throw new Error('bad DER')
      let l = sig[i++]
      if (l & 0x80) { const n = l & 0x7f; l = 0; for (let k = 0; k < n; k++) l = l * 256 + sig[i++] }
      const v = sig.subarray(i, i + l); i += l
      return BigInt('0x' + v.toString('hex'))
    }
    const r = readInt()
    const s = readInt()
    const halfN = N / 2n
    if (s <= halfN) return sig.toString('base64')
    const encodeInt = (x) => {
      let hex = x.toString(16)
      if (hex.length % 2) hex = '0' + hex
      let bytes = hex.match(/../g).map((h) => parseInt(h, 16))
      while (bytes.length > 1 && bytes[0] === 0) bytes.shift()
      if (bytes[0] & 0x80) bytes.unshift(0)
      return [0x02, bytes.length, ...bytes]
    }
    const body = [...encodeInt(r), ...encodeInt(N - s)]
    return Buffer.from([0x30, body.length, ...body]).toString('base64')
  } catch {
    // DER 解析异常时退回原始签名（服务端一般也接受高 s）
    return sig.toString('base64')
  }
}

/** 构造新版 ExchangeToken 的 (DeviceProof, DeviceInfo) */
function traeDeviceProof(path, refreshToken, keys, clientId, platformCode) {
  const ts = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomBytes(16).toString('hex')
  // 签名内容：POST\n{path}\n{clientId}\n{refreshToken}\n{ts}\n{nonce}（上游 2026-09 抓包固化）
  const canonical = ['POST', path, clientId, refreshToken, String(ts), nonce].join('\n')
  const proof = {
    Timestamp: ts,
    Nonce: nonce,
    Signature: ecSignLowS(keys.privateKeyPem, Buffer.from(canonical, 'utf8')),
  }
  const info = {
    DeviceID: keys.deviceId,
    MachineID: keys.machineId || '',
    PlatformCode: platformCode,
    DeviceType: 'PC',
    DeviceName: process.env.TRAE_DEVICE_NAME || os.hostname() || 'PC',
    DeviceModel: process.env.TRAE_DEVICE_MODEL || '',
    ClientVersion: TRAE_CLIENT_VERSION,
    DevicePublicKey: keys.publicKeyPem,
    DeviceBrand: process.env.TRAE_DEVICE_BRAND || '',
    DeviceCPU: '',
    OSInfo: os.platform() === 'win32' ? 'Windows' : (os.platform() === 'darwin' ? 'Darwin' : 'Linux'),
    OSVersion: os.release() || '',
  }
  return { proof, info }
}

/** 账号键必须基于稳定字段，不能用每次都变的 accessToken */
function accountKey(cred) {
  return uidHash(String(
    cred.accountName || cred.userId || cred.deviceId || cred.refreshToken || cred.token || ''
  ))
}

/**
 * 请求头必须与官方客户端逐字段一致（上游对照实测）：
 *   • x-device-id 只发一个小写 —— 同时发大小写两个头会被服务端判为异常客户端（鉴权直接失败）
 *   • 缺 x-device-type / x-os-version / x-app-version 时也可能被拒
 */
function buildHeaders(cred) {
  const deviceId = String(cred.deviceId || '').trim()
  const platform = os.platform()
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Cloud-IDE-JWT ' + cred.token,
    'X-User-Region': 'CN',
    'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION,
    'x-device-type': platform === 'win32' ? 'Windows' : (platform === 'darwin' ? 'Darwin' : 'Linux'),
    'x-os-version': os.release() || '10.0.19045',
    'x-app-version': TRAE_CLIENT_VERSION,
  }
  if (deviceId) headers['x-device-id'] = deviceId
  return headers
}

async function loadSaved(ctx, cred, key) {
  const store = atomicReadJSON(statePath(ctx.stateDir, TRAE_STATE_FILE), { version: 1, accounts: {} })
  const saved = store && store.accounts && store.accounts[key]
  if (!saved) return cred
  // 令牌库里的 deviceId 可能是历史版本写坏的（如 BoundDeviceID 形式的非数字号），
  // 遇到这种情况优先回到凭证里的真实客户端设备号
  const credDeviceId = String(cred.deviceId || '')
  const savedDeviceId = String(saved.deviceId || '')
  const deviceId = isAhaDeviceId(credDeviceId) ? credDeviceId : (isAhaDeviceId(savedDeviceId) ? savedDeviceId : (credDeviceId || savedDeviceId))
  return {
    ...cred,
    token: saved.token || cred.token,
    refreshToken: saved.refreshToken || cred.refreshToken,
    expiresAt: saved.expiresAt || cred.expiresAt,
    deviceId: deviceId,
    userId: saved.userId || cred.userId,
    clientId: saved.clientId || cred.clientId,
    reqSource: saved.reqSource || cred.reqSource,
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
      clientId: cred.clientId || '',
      reqSource: cred.reqSource || 0,
      updatedAt: Date.now(),
    }
    atomicWriteJSON(file, store)
  })
}

function buildRefreshed(cred, result, clientId, reqSource) {
  let expiresAt = Number(result.TokenExpireAt || result.expiresAt || 0)
  if (expiresAt > 1e12) expiresAt = Math.floor(expiresAt / 1000)
  if (expiresAt < 1e10) expiresAt = expiresAt * 1000
  // ⚠️ 绝不能用响应里的 BoundDeviceID 当 x-device-id：它是服务端内部绑定标识
  // （形如 o68qk40e1q4jle），不是客户端注册的 Aha 数字设备号。用它会导致
  // 后续请求鉴权失败（401）与续期 20403 Token device not match。
  const boundDeviceId = result.BoundDeviceID || result.boundDeviceId || ''
  return {
    ...cred,
    token: result.Token,
    refreshToken: result.RefreshToken || result.refreshToken || cred.refreshToken,
    expiresAt: expiresAt || (Date.now() + 3600 * 1000),
    // 设备号一律沿用凭证里的真实客户端号；bound 标识只记录备查
    deviceId: isAhaDeviceId(cred.deviceId) ? cred.deviceId : (isAhaDeviceId(boundDeviceId) ? boundDeviceId : cred.deviceId),
    boundDeviceId: boundDeviceId || cred.boundDeviceId || '',
    clientId: clientId || cred.clientId,
    reqSource: reqSource || cred.reqSource,
  }
}

async function traeRefreshCredential(cred, ctx) {
  const keys = traeDeviceKeys(cred)

  // ① 新版端点：带设备证明（DeviceProof + DeviceInfo）。缺证明服务端回 20405。
  //    (ClientID, PlatformCode) 组合链（上游实测）：IDE → 旧ID/IDE_PC → 旧ID/SOLO_PC，
  //    只有 10101（RT 与客户端不匹配）/ 20403（设备不匹配）才换下一个组合。
  if (keys) {
    const custom = (cred.clientId || process.env.TRAE_CLIENT_ID || cred.reqSource || process.env.TRAE_REQ_SOURCE)
      ? traeProfiles(cred).map((p) => ({ clientId: p.clientId, platformCode: p.platformCode || 'IDE_PC', reqSource: p.reqSource }))
      : null
    const combos = custom || [
      { clientId: TRAE_PROFILES[0].clientId, platformCode: 'IDE_PC', reqSource: 1 },
      { clientId: TRAE_PROFILES[1].clientId, platformCode: 'IDE_PC', reqSource: 1 },
      { clientId: TRAE_PROFILES[1].clientId, platformCode: 'SOLO_PC', reqSource: 2 },
    ]
    let lastErr = null
    for (const combo of combos) {
      const { proof, info } = traeDeviceProof(TRAE_REFRESH_PROOF_PATH, cred.refreshToken, keys, combo.clientId, combo.platformCode)
      let resp
      try {
        resp = await ctx.http.request('POST', TRAE_API_HOST + TRAE_REFRESH_PROOF_PATH, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION,
            'x-cloudide-token': '',
          },
          body: {
            ClientID: combo.clientId,
            ClientSecret: '',
            RefreshToken: cred.refreshToken,
            DeviceInfo: info,
            DeviceProof: proof,
            IDEVersion: TRAE_CLIENT_VERSION,
          },
          timeout: 60000,
        })
      } catch (e) {
        lastErr = e
        continue
      }
      const result = resp.data && (resp.data.Result || resp.data.result || resp.data.data)
      if (result && result.Token) {
        return buildRefreshed(cred, result, combo.clientId, combo.reqSource)
      }
      const errMsg = resp.data && (resp.data.Message || resp.data.message || JSON.stringify(resp.data))
      lastErr = new Error('TRAE Token 刷新失败: ' + ctx.http.truncate(errMsg))
      if (!/10101|20403/.test(lastErr.message)) break
    }
    if (lastErr) {
      throw new Error(lastErr.message + traeRefreshHint(lastErr.message))
    }
    throw new Error('TRAE Token 刷新失败')
  }

  // ② 旧端点兜底（未配置设备密钥时；新版服务端可能回 20405 要求证明）
  let lastErr = null
  for (const profile of traeProfiles(cred)) {
    let resp
    try {
      resp = await ctx.http.request('POST', TRAE_AUTH_HOST + TRAE_REFRESH_PATH, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Trae/' + TRAE_CLIENT_VERSION },
        body: {
          ClientID: profile.clientId,
          RefreshToken: cred.refreshToken,
          ClientSecret: '-',
          UserID: cred.userId || '',
        },
        timeout: 60000,
      })
    } catch (e) {
      lastErr = e
      continue
    }
    const result = resp.data && (resp.data.Result || resp.data.result || resp.data.data)
    if (result && result.Token) {
      return buildRefreshed(cred, result, profile.clientId, profile.reqSource)
    }
    const errMsg = resp.data && (resp.data.Message || resp.data.message || JSON.stringify(resp.data))
    lastErr = new Error('TRAE Token 刷新失败: ' + ctx.http.truncate(errMsg))
    // 20101 是 RT 本身失效，换 ClientID 谱系没有意义
    if (isRefreshRejected(lastErr.message)) break
  }
  if (lastErr instanceof Error && lastErr.message) {
    throw new Error(lastErr.message + traeRefreshHint(lastErr.message))
  }
  throw lastErr || new Error('TRAE Token 刷新失败')
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
      // 区分明确拒绝与网络抖动：明确拒绝且 AT 也过期时不再发无效请求
      // 20101 = RT 失效；20405 = 缺设备证明；20403 = 设备与 token 不匹配
      const rejected = isRefreshRejected(e.message) || /20405/.test(e.message) || /20403/.test(e.message)
      const atAlive = cred.expiresAt && cred.expiresAt > Date.now() + 60 * 1000
      if (rejected) {
        const code = /20405/.test(e.message) ? '20405 设备证明' : (/20403/.test(e.message) ? '20403 设备与 token 不匹配' : '20101')
        console.log('    [TRAE] ⚠️ 刷新被服务端明确拒绝（' + code + '），该账号需要修复凭证')
        if (atAlive) {
          console.log('    [TRAE] 现有 AT 仍在有效期内，继续用它签到')
        } else {
          cred.authDead = true
          cred.authError = e.message
          console.log('    [TRAE] 现有 AT 也已过期，跳过本次签到')
        }
      } else {
        console.log('    [TRAE] 刷新失败（疑似网络抖动），改用现有 token: ' + ctx.http.truncate(e.message, 100))
      }
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
      headers: buildHeaders(cred), body: { req_source: reqSourceOf(cred) }, timeout: 30000,
    })
  } catch {
    // 状态查询是「免费请求」，失败不应阻断后续 claim
    return { status: 0, data: null }
  }
}

async function traeCheckin(cred, ctx, key) {
  let validCred = await traeEnsureValid(cred, ctx, key)
  // 续期被服务端明确拒绝且 AT 过期：给出可执行的修复动作，不再发无效请求
  if (validCred.authDead) {
    return {
      success: false,
      message: '续期失败，无法签到：' + (validCred.authError || 'RT 已失效（20101）') +
        '；处理：重新提取该账号凭证（npm run extract -- --trae）',
    }
  }
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
      headers, body: { req_source: reqSourceOf(validCred) }, timeout: 30000,
    })
    lastResp = resp
    const data = resp.data

    // 9004/9095：该设备今日已签（设备维度限额），按成功处理
    if (data && (data.code === 9004 || data.code === 9095)) {
      return { success: true, message: '今日已签到（本设备今日额度已用）', points: creditsOf(data) }
    }
    // 9074 的文案是「当前参与用户太多」，但上游对照实测根因是设备号不被认可，重试无效
    if (data && data.code === 9074) break

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
  if (data && data.code === 9074) {
    return {
      success: false,
      message: isAhaDeviceId(validCred.deviceId)
        ? '9074 设备号未被认可：确认该 deviceId 是本账号在客户端真实注册过的号（一个真设备号一天只能签一个账号）'
        : '9074 设备号未被认可：deviceId 不是 12~20 位十进制数字，请重新提取客户端真实设备号',
    }
  }
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
      if (!isAhaDeviceId(merged.deviceId)) {
        console.log('    ⚠️ deviceId 不是 12~20 位十进制数字' +
          (merged.deviceId ? '（' + ctx.http.truncate(merged.deviceId, 12) + '）' : '（为空）') +
          '，9074 通常由此触发')
      }
      const result = await traeCheckin(merged, ctx, key)
      results.push({ platform: 'TRAE', name, ...result })
      const pts = result.points ? ' (+' + result.points + '积分)' : ''
      console.log('    ' + (result.success ? '✅ ' : '❌ ') + result.message + pts)
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
  accountKey, traeCheckedIn, traeCheckStatus, isAhaDeviceId, traeProfiles,
  traeDeviceKeys, ecSignLowS, traeDeviceProof,
}
