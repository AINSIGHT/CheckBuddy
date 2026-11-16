/**
 * WorkBuddy 凭证：三种格式归一化、本地体检、令牌库原子持久化。
 *
 * 输入格式（可同时配置，自动合并）：
 *   1. WORKBUDDY_CREDENTIALS  JSON 数组 { token, uid, enterprise_id, domain }        （旧格式）
 *   2. WORKBUDDY_CREDENTIALS  JSON 数组 { token, refreshToken, phone, ... }          （新格式）
 *   3. WORKBUDDY_REFRESH_TOKEN 多行 手机号:AT:RT（AT 可留空，分隔符也支持 &）      （对方仓库同款）
 */
'use strict'

const { envStr, parseEnvJson } = require('../../lib/env')
const { atomicReadJSON, atomicWriteJSON, withLock, uidHash, statePath } = require('../../lib/state')

const TOKEN_STORE = 'wb_refresh_tokens.json'
const WB_UA = 'WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0'
const WB_ORIGIN = 'https://www.workbuddy.cn'
const WB_LOGIN_BASE = 'https://www.workbuddy.cn'
const WB_REFRESH_URL = 'https://copilot.tencent.com/v2/plugin/auth/token/refresh'
const WB_DEFAULT_BASE = 'https://www.codebuddy.cn'
const WB_FALLBACK_BASE = 'https://www.workbuddy.cn'
const STATUS_PATHS = ['/v2/billing/meter/checkin-activity-status', '/v2/billing/meter/checkin-status']

function baseUrls() {
  const primary = envStr('WB_BASE_URL', WB_DEFAULT_BASE).replace(/\/+$/, '')
  return primary === WB_FALLBACK_BASE ? [primary] : [primary, WB_FALLBACK_BASE]
}

function decodeJwt(token) {
  try {
    const parts = String(token).split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(payload)
  } catch { return null }
}

function maskPhone(p) {
  if (!p) return ''
  return p.length > 7 ? p.slice(0, 3) + '****' + p.slice(-4) : '***'
}

/**
 * 本地凭据体检（不联网）。返回硬错误 problems 与提示 warnings。
 * 只做格式判断，签发域不同仅给提示，避免上游换域导致误拦截。
 */
function inspectCredential(cred) {
  const problems = []
  const warnings = []
  const rt = cred.rt || ''
  const at = cred.at || ''

  if (!at) warnings.push('未提供 AT，将先通过 RT 续期获取')
  if (!rt) {
    warnings.push('未提供 refresh token（RT），将以只读 AT 模式运行，令牌过期后需重新提取')
    return { problems, warnings, refreshable: false }
  }
  if (!/^eyJ/.test(rt) || rt.split('.').length !== 3) {
    problems.push('RT 不是 eyJ 开头的三段式 JWT（可能被截断、带引号/空格，或是加密信封）')
    return { problems, warnings, refreshable: false }
  }
  const p = decodeJwt(rt) || {}
  if (p.typ === 'Bearer') problems.push('RT 的 typ=Bearer，说明 AT/RT 顺序写反了（应为 手机号:AT:RT）')
  if (p.typ && p.typ !== 'Offline' && p.typ !== 'Refresh') {
    warnings.push('RT 的 typ=' + p.typ + '（通常应为 Offline）')
  }
  if (p.iss && !/codebuddy\.cn|workbuddy\.cn|copilot\.tencent\.com/.test(p.iss)) {
    warnings.push('RT 签发域为 ' + p.iss + '，可能粘成了国际版或其他应用的令牌')
  }
  const ap = decodeJwt(at)
  if (ap && ap.typ === 'Offline') problems.push('AT 的 typ=Offline，说明 AT/RT 顺序写反了')
  if (/^\{"\$wbEncrypted"/.test(rt) || /envelope/.test(rt)) {
    problems.push('这是新版客户端的加密信封（AtRestEncryption），请改用 node tools/workbuddy-login.cjs 短信登录')
  }
  return { problems, warnings, refreshable: problems.length === 0 }
}

/** 统一业务请求头（签到 / 查询 / 任务域共用） */
function buildHeaders(cred, extra = {}) {
  const headers = {
    Authorization: 'Bearer ' + (cred.at || ''),
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': WB_UA,
    Origin: WB_ORIGIN,
    Referer: WB_ORIGIN + '/profile/growth-center',
    ...extra,
  }
  if (cred.uid) headers['X-User-Id'] = String(cred.uid)
  if (cred.enterpriseId) {
    headers['X-Enterprise-Id'] = String(cred.enterpriseId)
    headers['X-Tenant-Id'] = String(cred.enterpriseId)
  }
  if (cred.domain) headers['X-Domain'] = String(cred.domain)
  return headers
}

function parseRefreshTokenEnv() {
  const raw = envStr('WORKBUDDY_REFRESH_TOKEN')
  if (!raw) return []
  const out = []
  for (const line of raw.split(/[\r\n&]+/).map((s) => s.trim()).filter(Boolean)) {
    // JWT 不含冒号，按最多 3 段切分；"手机号::RT" 表示 AT 留空
    const parts = line.split(':')
    if (parts.length < 3) {
      console.log('  ⚠️ 忽略格式错误的 WORKBUDDY_REFRESH_TOKEN 行（应为 手机号:AT:RT）')
      continue
    }
    const phone = parts[0].trim()
    const rt = parts[parts.length - 1].trim()
    const at = parts.slice(1, -1).join(':').trim()
    if (!phone || !rt) continue
    out.push({ phone, at, rt })
  }
  return out
}

function normalizeJsonEntry(e) {
  const at = String(e.token || e.accessToken || e.at || '').trim()
  const rt = String(e.refreshToken || e.refresh_token || e.rt || '').trim()
  return {
    phone: String(e.phone || e.accountName || '').trim(),
    uid: String(e.uid || e.userId || '').trim(),
    at, rt,
    enterpriseId: String(e.enterprise_id || e.enterpriseId || '').trim(),
    domain: String(e.domain || '').trim(),
  }
}

/** 读取令牌库（轮换后的 AT/RT 以令牌库为准） */
function readStore(ctx) {
  const file = statePath(ctx.stateDir, TOKEN_STORE)
  const store = atomicReadJSON(file, { version: 1, accounts: {} })
  return store && store.accounts ? store : { version: 1, accounts: {} }
}

async function persistAccount(ctx, account) {
  const file = statePath(ctx.stateDir, TOKEN_STORE)
  await withLock(file, async () => {
    const store = readStore(ctx)
    store.accounts[account.key] = {
      at: account.at || '', rt: account.rt || '',
      lastRefresh: account.lastRefresh || 0,
      expiresAt: account.expiresAt || 0,
      phoneHint: maskPhone(account.phone),
    }
    atomicWriteJSON(file, store)
  })
}

/** 归一化三种输入 + 覆盖令牌库，得到统一账号对象 */
function loadAccounts(ctx) {
  const jsonEntries = (parseEnvJson('WORKBUDDY_CREDENTIALS') || []).map(normalizeJsonEntry)
  const rtEntries = parseRefreshTokenEnv()
  const byKey = new Map()

  for (const e of [...jsonEntries, ...rtEntries]) {
    const jwt = decodeJwt(e.at) || decodeJwt(e.rt) || {}
    const uid = e.uid || String(jwt.sub || '').trim()
    const key = uidHash(e.phone || uid || e.at || e.rt)
    const prev = byKey.get(key) || {}
    byKey.set(key, {
      ...prev,
      phone: e.phone || prev.phone || '',
      uid: uid || prev.uid || '',
      at: e.at || prev.at || '',
      rt: e.rt || prev.rt || '',
      enterpriseId: e.enterpriseId || prev.enterpriseId || '',
      domain: e.domain || prev.domain || '',
      key,
    })
  }

  const store = readStore(ctx)
  const accounts = []
  let idx = 0
  for (const acc of byKey.values()) {
    idx++
    const saved = store.accounts[acc.key] || {}
    if (saved.rt) acc.rt = saved.rt
    if (saved.at) acc.at = saved.at
    acc.lastRefresh = saved.lastRefresh || 0
    const jwt = decodeJwt(acc.at)
    acc.expiresAt = jwt && jwt.exp ? jwt.exp * 1000 : (saved.expiresAt || 0)
    acc.name = maskPhone(acc.phone) || (acc.uid ? 'uid:' + String(acc.uid).slice(0, 6) : 'WorkBuddy账号' + idx)
    acc.refreshable = !!acc.rt
    accounts.push(acc)
  }
  return accounts
}

module.exports = {
  TOKEN_STORE, WB_UA, WB_ORIGIN, WB_LOGIN_BASE, WB_REFRESH_URL, STATUS_PATHS,
  baseUrls, decodeJwt, maskPhone, inspectCredential, buildHeaders,
  readStore, persistAccount, loadAccounts,
}
