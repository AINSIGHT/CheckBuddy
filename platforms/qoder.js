/**
 * Qoder 签到（多账号）
 * 参考: pi-provider-qoder + iicookies/auto-checkin
 *      + L0NE-6/Qoder-Daily（campaigns 体系 / 设备头字段名 / claim 形态，2026-11 源码核对）
 *
 * 端点探测顺序：
 *   ① campaigns 体系（上游当前主路径）：
 *      GET /sash/api/v1/me/campaigns → 筛 CLAIM_BENEFIT + CREDITS 行 →
 *      POST /sash/api/v1/me/campaigns/{id}/claim（最小鉴权头 + 空 body，避免 503 风控）
 *   ② daily-check-in 旧端点兜底（status → claim）
 * 设备头字段名（源码确认）：Cosy-MachineToken / Cosy-MachineCode / Cosy-MachineType /
 *   Cosy-MachineOS / Cosy-MachineId / Cosy-MachineHostname；UMID 由 runtime-info 组件生成。
 */
'use strict'

const os = require('os')
const { envInt } = require('../lib/env')
const { isAuthFail } = require('../lib/errors')
const { atomicReadJSON, atomicWriteJSON, statePath, uidHash } = require('../lib/state')

// 上游实测：中国版 openapi.qoder.com.cn，国际版 openapi.qoder.sh
const QODER_BASES = {
  cn: 'https://openapi.qoder.com.cn',
  global: 'https://openapi.qoder.sh',
}
const QODER_PAT_EXCHANGE_URL = QODER_BASES.cn + '/api/v1/jobToken/exchange'
const QODER_STATE_FILE = 'qoder_tokens.json'
// 上游实测：sash 接口 ClientType=10、UA=Qoder、Cosy-Version 兜底 1.1.69
const QODER_SASH_CLIENT_TYPE = '10'
const QODER_SASH_UA = 'Qoder'
const QODER_COSY_VERSION = '1.1.69'

/** 地区基址：凭证 base / QODER_BASE 优先，其次 QODER_REGION（cn|global） */
function qoderBase(cred) {
  const explicit = String((cred && cred.base) || process.env.QODER_BASE || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const region = String((cred && cred.region) || process.env.QODER_REGION || 'cn').toLowerCase()
  return (region === 'global' || region === 'intl' || region === 'international') ? QODER_BASES.global : QODER_BASES.cn
}

function qoderUrls(cred) {
  const base = qoderBase(cred)
  return {
    base,
    status: base + '/sash/api/v1/me/daily-check-in/status',
    claim: base + '/sash/api/v1/me/daily-check-in/claim',
    campaigns: base + '/sash/api/v1/me/campaigns',
  }
}

/** 账号键必须稳定（token 会轮换，不能用 token 做键） */
function qoderCredKey(cred) {
  return uidHash(String(cred.accountName || cred.email || cred.userId || cred.token || ''))
}

/**
 * Cosy-* 设备头：2026-09-26 起官方接口要求，缺失时更容易只返回「活动未下发」。
 * UMID 三件套来自客户端 `resources/umid/runtime-info.exe --account-stdin`。
 * 头名可能随官方调整，故提供 QODER_EXTRA_HEADERS（JSON）兜底覆盖，避免改代码。
 */
function qoderHasUmid(cred) {
  return !!((cred && cred.machineToken) || process.env.QODER_MACHINE_TOKEN ||
    (cred && cred.machineCode) || process.env.QODER_MACHINE_CODE ||
    (cred && cred.machineType) || process.env.QODER_MACHINE_TYPE)
}

/** 设备三件套头：优先凭证 JSON 内嵌字段（extract 已导出），其次环境变量 */
function qoderMachineHeaders(cred) {
  const headers = {}
  const machine = {
    'Cosy-MachineToken': (cred && cred.machineToken) || process.env.QODER_MACHINE_TOKEN,
    'Cosy-MachineCode': (cred && cred.machineCode) || process.env.QODER_MACHINE_CODE,
    'Cosy-MachineType': (cred && cred.machineType) || process.env.QODER_MACHINE_TYPE,
  }
  for (const [k, v] of Object.entries(machine)) if (v) headers[k] = String(v)
  return headers
}

function qoderDeviceHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Cosy-Version': process.env.QODER_COSY_VERSION || '1.0.1',
    'Cosy-ClientType': String(process.env.QODER_CLIENT_TYPE || '5'),
  }
  const machine = {
    'Cosy-MachineToken': process.env.QODER_MACHINE_TOKEN,
    'Cosy-MachineCode': process.env.QODER_MACHINE_CODE,
    'Cosy-MachineType': process.env.QODER_MACHINE_TYPE,
  }
  for (const [k, v] of Object.entries(machine)) if (v) headers[k] = String(v)
  if (process.env.QODER_EXTRA_HEADERS) {
    try {
      const extra = JSON.parse(process.env.QODER_EXTRA_HEADERS)
      for (const [k, v] of Object.entries(extra || {})) if (v != null) headers[k] = String(v)
    } catch { /* 非法 JSON 直接忽略，不影响签到 */ }
  }
  return headers
}

async function qoderExchangeJobToken(pat, ctx) {
  const headers = qoderDeviceHeaders()
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

function buildQoderHeaders(jobToken, cred) {
  return { Authorization: 'Bearer ' + jobToken, ...qoderDeviceHeaders(), ...qoderMachineHeaders(cred) }
}

/** 把 QODER_EXTRA_HEADERS 应用到任意头集合（官方改字段名时的兜底） */
function applyExtraHeaders(headers) {
  if (process.env.QODER_EXTRA_HEADERS) {
    try {
      const extra = JSON.parse(process.env.QODER_EXTRA_HEADERS)
      for (const [k, v] of Object.entries(extra || {})) if (v != null) headers[k] = String(v)
    } catch { /* 非法 JSON 直接忽略，不影响签到 */ }
  }
  return headers
}

/** sash 接口最小鉴权头四件套（CN 实测形态：campaigns 空表复取 / claim 用它避免 503 风控） */
function qoderSashHeaders(token) {
  return applyExtraHeaders({
    authorization: 'Bearer ' + token,
    'User-Agent': process.env.QODER_SASH_UA || QODER_SASH_UA,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Cosy-ClientType': String(process.env.QODER_CLIENT_TYPE || QODER_SASH_CLIENT_TYPE),
  })
}

function qoderMachineOs() {
  if (process.env.QODER_MACHINE_OS) return process.env.QODER_MACHINE_OS
  const arch = os.arch() === 'arm64' ? 'aarch64' : 'x86_64'
  const platform = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'darwin' : 'linux')
  return arch + '_' + platform
}

/** 完整设备风控头（campaigns 拉列表 / 国际版 claim 用），字段名经上游源码核对 */
function qoderRiskHeaders(token, cred) {
  const headers = qoderSashHeaders(token)
  headers['Cosy-Version'] = process.env.QODER_COSY_VERSION || QODER_COSY_VERSION
  headers['Cosy-MachineOS'] = qoderMachineOs()
  const machineId = String((cred && cred.machineId) || process.env.QODER_MACHINE_ID || '').trim()
  if (machineId) headers['Cosy-MachineId'] = machineId
  const hostname = String(process.env.QODER_MACHINE_HOSTNAME || os.hostname() || '').trim()
  if (hostname) headers['Cosy-MachineHostname'] = hostname
  Object.assign(headers, qoderMachineHeaders(cred))
  return headers
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

/** claim 幂等冲突：今天已经领过（服务端 409 / Resource already exists） */
const ALREADY_CLAIMED_RE = /already\s*(claimed|exists|checked|checkin)|resource\s+already|已(领取|签到|存在)|重复领取|请勿重复/i

/** 本轮活动未下发的判定（保守：仅 4xx 且文案命中，网络错误不进入等待） */
function isCampaignPending(resp, message) {
  if (!resp || resp.status >= 500 || resp.status === 0) return false
  return /未下发|未开始|活动|campaign|暂不可|not found|no campaign/i.test(String(message || ''))
}

/** campaigns 每日签到行：必须同时满足 actionType=CLAIM_BENEFIT、benefit.kind=CREDITS、非空 campaignId */
function qoderDailyRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' &&
    r.actionType === 'CLAIM_BENEFIT' && r.benefit && r.benefit.kind === 'CREDITS' && r.campaignId)
}

/** campaigns claim 回执：CLAIMED/GRANTED/SUCCESS/replayed 才算成功，409+ALREADY/REPLAYED 算已领 */
function qoderCampaignClaimOutcome(resp) {
  const d = (resp && resp.data) || {}
  const inner = d.data && typeof d.data === 'object' ? d.data : {}
  const result = String(d.result || d.claimStatus || inner.result || inner.claimStatus || '')
  const replayed = d.replayed === true || inner.replayed === true
  const msgRaw = d.message || d.error || d.errorMessage || d.msg || ''
  const message = typeof msgRaw === 'string' ? msgRaw : JSON.stringify(msgRaw)
  if (resp && resp.status >= 200 && resp.status < 300) {
    if (['CLAIMED', 'GRANTED', 'SUCCESS'].includes(result) || replayed) {
      return { claimed: true, message: replayed ? '今日已签到' : '签到成功' }
    }
    if (!d.error && !d.errorCode && !result) return { claimed: true, message: '签到成功' }
  }
  if (result === 'ALREADY_CLAIMED' || ALREADY_CLAIMED_RE.test(message)) {
    return { claimed: true, message: '今日已签到' }
  }
  return { claimed: false, message: message || ('HTTP ' + (resp && resp.status)) }
}

/**
 * ① campaigns 体系探测（上游 2026-10 起的每日活动制）：
 * 拉列表 → 筛每日行 → claim（最小头 + 空 body，503 风控时回退完整设备头）。
 * 拿不到每日活动行 / 接口不可用时返回 null，交给 daily-check-in 旧端点兜底。
 */
async function qoderCheckinViaCampaigns(validCred, ctx, riskHeaders, minimalHeaders) {
  const urls = qoderUrls(validCred)
  let resp
  try {
    resp = await ctx.http.request('GET', urls.campaigns, { headers: riskHeaders, timeout: 30000 })
  } catch {
    console.log('    [Qoder] campaigns 请求失败，回落 daily-check-in 端点')
    return null
  }
  if (resp.status >= 400 || !resp.data || typeof resp.data !== 'object') {
    if (resp.status === 401 || resp.status === 403) {
      console.log('    [Qoder] campaigns 鉴权失败(HTTP ' + resp.status + ')，回落 daily-check-in 端点')
    }
    return null
  }
  let rows = qoderDailyRows(resp.data.campaigns)
  // CN 实测形态：完整设备头返回 200 + showCampaign:false / 空表时，用最小头复取一次
  if (!rows.length) {
    try {
      const resp2 = await ctx.http.request('GET', urls.campaigns, { headers: minimalHeaders, timeout: 30000 })
      if (resp2.status < 400 && resp2.data && Array.isArray(resp2.data.campaigns)) {
        rows = qoderDailyRows(resp2.data.campaigns)
      }
    } catch { /* 复取失败沿用首次结果 */ }
  }
  if (!rows.length) return null
  const claimable = rows.find((r) => String(r.claimStatus || 'CLAIMABLE').toUpperCase() !== 'CLAIMED')
  if (!claimable) return { success: true, message: '今日已签到（campaigns 活动均已领取）' }

  const claimUrl = urls.campaigns + '/' + encodeURIComponent(claimable.campaignId) + '/claim'
  let claimResp
  try {
    claimResp = await ctx.http.request('POST', claimUrl, { headers: minimalHeaders, body: {}, timeout: 30000 })
  } catch (e) {
    claimResp = { status: 0, data: null, message: e.message }
  }
  // 最小头失败（如国际版要求完整设备头）→ 完整头重试一次
  if ((!claimResp.status || claimResp.status >= 400)) {
    try {
      const retry = await ctx.http.request('POST', claimUrl, { headers: riskHeaders, body: {}, timeout: 30000 })
      if (retry.status && retry.status < 400) claimResp = retry
    } catch { /* 沿用原响应做错误分类 */ }
  }
  // job token 中途失效：重新兑换一次再试
  if (isAuthFail(claimResp) && validCred.pat) {
    try {
      const fresh = await qoderExchangeJobToken(validCred.pat, ctx)
      claimResp = await ctx.http.request('POST', claimUrl, {
        headers: qoderSashHeaders(fresh.jobToken), body: {}, timeout: 30000,
      })
    } catch { /* 沿用原响应做错误分类 */ }
  }
  const outcome = qoderCampaignClaimOutcome(claimResp)
  if (outcome.claimed) return { success: true, message: outcome.message }
  if (isCampaignPending(claimResp, outcome.message)) return null
  return { success: false, message: outcome.message }
}

/** 读回上次续期得到的 token（drf/jrt 轮换后必须复用，否则原 RT 已失效） */
function qoderLoadSaved(ctx, cred) {
  const store = atomicReadJSON(statePath(ctx.stateDir, QODER_STATE_FILE), { version: 1, accounts: {} })
  const saved = store && store.accounts && store.accounts[qoderCredKey(cred)]
  if (!saved) return cred
  return {
    ...cred,
    token: saved.token || cred.token,
    refreshToken: saved.refreshToken || cred.refreshToken,
    base: saved.base || cred.base,
    expiresAt: saved.expiresAt || cred.expiresAt,
  }
}

async function qoderPersist(ctx, cred) {
  const file = statePath(ctx.stateDir, QODER_STATE_FILE)
  const store = atomicReadJSON(file, { version: 1, accounts: {} }) || { version: 1, accounts: {} }
  if (!store.accounts) store.accounts = {}
  store.accounts[qoderCredKey(cred)] = {
    token: cred.token || '',
    refreshToken: cred.refreshToken || '',
    base: cred.base || '',
    expiresAt: cred.expiresAt || 0,
    updatedAt: Date.now(),
  }
  atomicWriteJSON(file, store)
}

/**
 * 用 refresh_token 续期（上游实测端点）：
 *   drt-* → POST /api/v1/deviceToken/refresh（body: {refresh_token}）
 *   jrt-* → POST /api/v1/jobToken/refresh
 * 地区未知时先试 CN，失败再试国际版基址。
 */
async function qoderRefreshToken(cred, ctx) {
  const refresh = String(cred.refreshToken || '').trim()
  if (!refresh) return null
  const path = refresh.startsWith('jrt-') ? '/api/v1/jobToken/refresh' : '/api/v1/deviceToken/refresh'
  const bases = [qoderBase(cred)]
  if (!cred.base && !process.env.QODER_BASE) {
    bases.push(bases[0] === QODER_BASES.cn ? QODER_BASES.global : QODER_BASES.cn)
  }
  const headers = {
    'User-Agent': 'qoder-local-proxy',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  for (const base of bases) {
    let resp
    try {
      resp = await ctx.http.request('POST', base + path, {
        headers, body: { refresh_token: refresh }, timeout: 30000,
      })
    } catch (e) {
      console.log('    [Qoder] 续期请求失败(' + base.replace(/^https:\/\//, '') + '): ' + ctx.http.truncate(e.message, 60))
      continue
    }
    const d = (resp.data) || {}
    const inner = d.data && typeof d.data === 'object' ? d.data : {}
    // 国际版字段名是 device_token，中国版是 token；两者都兼容
    const token = d.device_token || d.token || d.access_token ||
      inner.device_token || inner.token || inner.access_token
    if (token && resp.status < 400) {
      const rawExp = d.expires_at || d.expiresAt || inner.expires_at || inner.expiresAt || 0
      let expiresAt = 0
      if (typeof rawExp === 'string' && /[A-Za-z]/.test(rawExp)) {
        expiresAt = Date.parse(rawExp) || 0 // ISO 时间字符串
      } else {
        expiresAt = Number(rawExp) || 0
        if (expiresAt > 1e12) { /* 已是毫秒 */ } else if (expiresAt > 1e9) expiresAt = expiresAt * 1000
      }
      return {
        ...cred,
        base,
        token,
        refreshToken: d.refresh_token || inner.refresh_token || refresh,
        expiresAt: expiresAt || (Date.now() + 3600 * 1000),
      }
    }
    const msg = d.message || d.error || d.errorMessage || d.errorCode || ('HTTP ' + resp.status)
    console.log('    [Qoder] 续期失败(' + base.replace(/^https:\/\//, '') + '): ' + ctx.http.truncate(String(msg), 80))
  }
  return null
}

/** token 失效类文案（触发续期重试） */
const QODER_AUTH_FAIL_RE = /invalid token|not active|unauthorized|未授权|登录失效|token.*(expired|invalid)|401/i

async function qoderCheckinOnce(validCred, ctx) {
  const urls = qoderUrls(validCred)

  // ① campaigns 体系（上游当前主路径）
  const viaCampaigns = await qoderCheckinViaCampaigns(
    validCred, ctx, qoderRiskHeaders(validCred.token, validCred), qoderSashHeaders(validCred.token))
  if (viaCampaigns) return viaCampaigns

  // 国际版没有 daily-check-in 端点（会 404 Not found），按「跳过」处理而不是失败
  if (qoderBase(validCred) === QODER_BASES.global) {
    return { skipped: true, success: true, message: '国际版暂无每日签到活动（跳过）' }
  }

  // ② daily-check-in 旧端点兜底（仅中国版）
  let headers = buildQoderHeaders(validCred.token, validCred)

  let statusResp
  try {
    statusResp = await ctx.http.request('GET', urls.status, { headers, timeout: 30000 })
  } catch { /* 状态查询失败，直接尝试签到 */ }

  const statusData = statusResp && statusResp.data
  if (statusData && statusData.status === 'CLAIMED_TODAY') {
    return {
      success: true, message: '今日已签到',
      credits: statusData.reward_credits || statusData.rewardCredits,
      streakDays: statusData.current_streak_days || statusData.currentStreakDays,
    }
  }

  let claimResp = await ctx.http.request('POST', urls.claim, { headers, body: {}, timeout: 30000 })
  // job token 中途过期：重新兑换一次再试
  if (isAuthFail(claimResp) && validCred.pat) {
    try {
      const fresh = await qoderExchangeJobToken(validCred.pat, ctx)
      headers = buildQoderHeaders(fresh.jobToken)
      claimResp = await ctx.http.request('POST', urls.claim, { headers, body: {}, timeout: 30000 })
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
  const errMsg = (claimData && (claimData.message || claimData.error || claimData.errorMessage || claimData.errorCode || claimData.msg)) || ('HTTP ' + claimResp.status) || '签到失败'
  const message = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)

  // claim 是幂等接口：今天已领过时服务端返回 Resource already exists / 409，
  // 这与 status 接口的 CLAIMED_TODAY 是同一事实，必须算成功，否则会误报失败。
  if (result === 'ALREADY_CLAIMED' || ALREADY_CLAIMED_RE.test(message)) {
    return { success: true, message: '今日已签到' }
  }
  if (isCampaignPending(claimResp, message)) {
    const hint = qoderHasUmid(validCred) ? '' : '（未配置 QODER_MACHINE_* 设备头时更易出现）'
    return { success: false, message: message + hint, pending: true }
  }
  return { success: false, message }
}

/**
 * 签到入口：token 失效（invalid token / token is not active / 401）时
 * 用 refresh_token 续期并重试一次 —— 否则每次都得手动重提取。
 */
async function qoderCheckin(cred, ctx) {
  let validCred = await qoderEnsureValid(cred, ctx)
  let result = await qoderCheckinOnce(validCred, ctx)
  if (!result.success && QODER_AUTH_FAIL_RE.test(String(result.message || '')) && validCred.refreshToken) {
    const refreshed = await qoderRefreshToken(validCred, ctx)
    if (refreshed) {
      console.log('    [Qoder] token 已失效，用 refresh_token 续期成功，重试签到')
      validCred = refreshed
      await qoderPersist(ctx, validCred)
      result = await qoderCheckinOnce(validCred, ctx)
    }
  }
  return result
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
    // 合并令牌库：上次续期轮换后的 token 必须复用（原 refresh_token 已失效）
    const cred = qoderLoadSaved(ctx, accounts[i])
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
      const icon = result.skipped ? '⏭ ' : (result.success ? '✅ ' : '❌ ')
      console.log('    ' + icon + result.message + credits + streak)
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
  qoderRefreshToken, qoderBase, qoderUrls,
}
