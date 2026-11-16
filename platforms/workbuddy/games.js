/**
 * 互动玩法（默认关闭，WB_GAMES=1 或 --games 开启）
 *
 * 本次只集成端点已在上游实测源码中核实的 4 项「最简单」玩法：
 *   lottery 抽奖 / blindbox 盲盒 / buddy_info Buddy 信息 / travel 派猫猫旅行
 *
 * 未集成（端点与回执结构未核实，且逻辑涉及活动期/日历/防重，不属于本次范围）：
 *   redeem 连签兑换 / makeup 补签卡 / gift 礼包补偿 / badges 徽章
 * 见 NOT_INTEGRATED 常量与 README 说明，后续拿到真实回执再补齐。
 *
 * 幂等原则（对齐上游）：先查状态再写、写后回读确认、状态未知时跳过所有写操作。
 * 玩法失败只写进报告明细，不影响签到结果。
 */
'use strict'

const crypto = require('crypto')
const { envStr, envBool, envList, envInt, beijingToday } = require('../../lib/env')
const { atomicReadJSON, atomicWriteJSON, withLock, statePath } = require('../../lib/state')
const creds = require('./credentials')

const STATE_FILE = 'wb_games_state.json'
const GAME_BASE_DEFAULT = 'https://www.workbuddy.cn'
const INTEGRATED = ['lottery', 'blindbox', 'buddy_info', 'travel']
const NOT_INTEGRATED = ['redeem', 'makeup', 'gift', 'badges']

function enabled(ctx) {
  return !!(ctx.args.games || envBool('WB_GAMES'))
}

function selected(ctx) {
  const allow = ctx.args.gamesTasks.length ? ctx.args.gamesTasks : envList('WB_GAMES_TASKS')
  const skip = ctx.args.gamesSkip.length ? ctx.args.gamesSkip : envList('WB_GAMES_SKIP')
  return INTEGRATED.filter((g) =>
    (!allow.length || allow.map(String).includes(g)) && !skip.map(String).includes(g))
}

function bases() {
  const primary = envStr('WB_GAMES_BASE_URL', GAME_BASE_DEFAULT).replace(/\/+$/, '')
  const secondary = creds.baseUrls()[0]
  return primary === secondary ? [primary] : [primary, secondary]
}

function pick(obj, names) {
  for (const n of names) if (obj && obj[n] != null) return obj[n]
  return undefined
}

/** 在 data/result/response 等常见信封里递归找字段（防循环） */
function dig(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null
  if (obj[key] != null) return obj[key]
  for (const w of ['data', 'result', 'resp', 'response']) {
    if (obj[w] && typeof obj[w] === 'object') {
      const found = dig(obj[w], key, depth + 1)
      if (found != null) return found
    }
  }
  return null
}

/** 双域名回退 + 可选退避重试；统一返回 {ok, status, data, raw} */
async function call(ctx, account, path, { method = 'GET', body = null, retries = 0 } = {}) {
  let last = { ok: false, status: 0, data: null, raw: null }
  for (const base of bases()) {
    let resp
    try {
      resp = await ctx.http.requestWithRetry(method, base + path, {
        headers: creds.buildHeaders(account), body, timeout: 20000,
      }, { retries })
    } catch (e) {
      last = { ok: false, status: 0, data: null, raw: null, error: e.message }
      continue
    }
    const raw = resp && resp.data && typeof resp.data === 'object' ? resp.data : null
    if (!raw) { last = { ok: false, status: resp.status, data: null, raw: null }; continue }
    const httpOk = resp.status >= 200 && resp.status < 300
    const codeOk = raw.code === 0 || raw.code === 200 || raw.code === undefined
    const data = raw.data && typeof raw.data === 'object' ? raw.data : raw
    if (httpOk && codeOk) return { ok: true, status: resp.status, data, raw }
    last = { ok: false, status: resp.status, data, raw }
  }
  return last
}

// ---------------------------------------------------------------- 本地防重

function readState(ctx) {
  const s = atomicReadJSON(statePath(ctx.stateDir, STATE_FILE), { version: 1, accounts: {} })
  return s && s.accounts ? s : { version: 1, accounts: {} }
}

async function withState(ctx, account, fn) {
  const file = statePath(ctx.stateDir, STATE_FILE)
  return withLock(file, async () => {
    const store = readState(ctx)
    const key = account.key
    const entry = store.accounts[key] || {}
    if (entry.day !== beijingToday()) {
      entry.day = beijingToday()
      entry.departedAt = 0
    }
    const result = fn(entry)
    store.accounts[key] = entry
    atomicWriteJSON(file, store)
    return result
  })
}

// ---------------------------------------------------------------- 玩法实现

/** 旅行前置：领取 arrived 礼物并回读确认 idle；返回 {state, dailyLimitReached, notes[]} */
async function travelPrepare(ctx, account, { claimArrived = true } = {}) {
  const notes = []
  const vis = await call(ctx, account, '/v2/activity/growth/buddy/visible')
  if (vis.ok) {
    const vd = vis.data || {}
    if (vd.buddy_visible === false || vd.has_buddy === false) {
      return { state: 'no_buddy', dailyLimitReached: false, notes: ['🐾 无 Buddy，跳过盲盒与派出'] }
    }
  }

  const read = () => call(ctx, account, '/v2/activity/growth/buddy/travel/status')
  const first = await read()
  if (!first.ok) return { state: 'unknown', dailyLimitReached: false, notes: ['🐾 旅行状态获取失败，跳过盲盒与派出'] }

  let sd = first.data || {}
  let state = String(sd.state || '').toLowerCase()
  if (!['idle', 'traveling', 'arrived'].includes(state)) {
    return { state: 'unknown', dailyLimitReached: false, notes: ['🐾 旅行状态无法识别，跳过盲盒与派出'] }
  }

  if (state === 'arrived') {
    if (!claimArrived) {
      return {
        state: 'arrived', dailyLimitReached: !!sd.daily_limit_reached,
        notes: ['🐾 已到达但礼物尚未领取（只读探测），跳过盲盒与派出'],
      }
    }
    const recordId = sd.record_id
    if (recordId == null || recordId === '' || recordId === 0) {
      return { state: 'unknown', dailyLimitReached: false, notes: ['🐾 已到达但缺少 record_id，本轮不领奖也不派出'] }
    }
    const claim = await call(ctx, account, '/v2/activity/growth/buddy/travel/claim', {
      method: 'POST', body: { record_id: recordId },
    })
    const reward = dig(claim.raw || {}, 'reward_credit')
    if (!claim.ok || reward == null) {
      return { state: 'unknown', dailyLimitReached: false, notes: ['🐾 领取未确认（回执缺 reward_credit），跳过盲盒与派出'] }
    }
    notes.push('🐾 领取到达礼物 +' + reward + ' 积分')
    const after = await read()
    if (!after.ok) return { state: 'unknown', dailyLimitReached: false, notes }
    sd = after.data || {}
    state = String(sd.state || '').toLowerCase()
    if (state !== 'idle') {
      notes.push('🐾 领取后状态仍为 ' + (state || '未知') + '，跳过盲盒与派出')
      return { state: state || 'unknown', dailyLimitReached: !!sd.daily_limit_reached, notes }
    }
    notes.push('🐾 回读确认已回到 idle')
  }

  if (state === 'traveling') {
    const arriveAt = Number(sd.arrive_at || 0)
    const serverNow = Number(sd.server_now || 0)
    const remain = arriveAt > serverNow ? Math.max(0, Math.floor((arriveAt - serverNow) / 60)) : null
    notes.push('🐾 旅行中' + (remain != null ? '，约 ' + remain + ' 分钟后到达' : ''))
    return { state: 'traveling', dailyLimitReached: !!sd.daily_limit_reached, notes }
  }
  return { state: 'idle', dailyLimitReached: !!sd.daily_limit_reached, notes }
}

/** 盲盒：仅在旅行状态确认 idle 时开，按 affordable 上限，最多 5 次 */
async function blindbox(ctx, account, travelState) {
  if (!travelState || travelState.state !== 'idle') {
    return ['📦 盲盒: 旅行状态' + ((travelState && travelState.state) || '未知') + '，跳过']
  }
  const q = await call(ctx, account, '/v2/activity/growth/buddy/quota')
  if (!q.ok) return ['📦 盲盒: 额度查询失败，跳过']
  const qd = q.data || {}
  const affordable = Math.max(0, Math.floor(Number(qd.affordable || 0)))
  if (!affordable) return ['📦 盲盒: 能量不足 (' + (qd.balance != null ? qd.balance : '?') + '/10)']
  const max = Math.min(envInt('WB_GAMES_MAX_BLINDBOX', 5), 10)
  const n = Math.min(affordable, max)
  const got = []
  for (let i = 0; i < n; i++) {
    const r = await call(ctx, account, '/v2/activity/growth/buddy/open', { method: 'POST', body: { count: 1 } })
    if (!r.ok) break
    const results = (r.data && r.data.results) || []
    if (!Array.isArray(results) || !results.length) break
    const it = results[0] || {}
    const ins = it.instance || {}
    const tpl = it.template || {}
    got.push(String(ins.name || tpl.name || '?') + '(' + (ins.rarity || tpl.rarity || '') + ')')
    if (i < n - 1) await ctx.http.sleep(1500)
  }
  return ['📦 盲盒: ' + (got.length ? '开出 ' + got.join('、') : '开启失败或额度已用尽')]
}

/** 派出下一趟：仅 idle + 今日名额未用尽 + 本地当日防重 */
async function travelDepart(ctx, account, travelState) {
  if (!travelState || travelState.state !== 'idle') return []
  if (travelState.dailyLimitReached) return ['🐾 今日旅行次数已用尽']
  const already = await withState(ctx, account, (e) => !!e.departedAt)
  if (already) return ['🐾 今日已派出过（本地防重），跳过']

  const cfg = await call(ctx, account, '/v2/activity/growth/buddy/travel/config')
  const list = cfg.ok
    ? (cfg.data.locations || cfg.data.destinations || cfg.data.list || cfg.data.items || [])
    : []
  const rows = Array.isArray(list) ? list : []
  if (!rows.length) return ['🐾 目的地列表为空或接口未下发，跳过派出']
  const loc = rows[0]
  const locationId = loc && (loc.location_id != null ? loc.location_id : loc.id)
  if (locationId == null) return ['🐾 目的地缺少 location_id，跳过派出']

  const r = await call(ctx, account, '/v2/activity/growth/buddy/travel/depart', {
    method: 'POST', body: { location_id: locationId },
  })
  if (!r.ok) return ['🐾 派出失败（HTTP ' + r.status + '），本地不写完成标记']
  await withState(ctx, account, (e) => { e.departedAt = Date.now() })
  return ['🐾 已派出下一趟 → ' + String(loc.name || locationId)]
}

/** Buddy 信息（纯只读） */
async function buddyInfo(ctx, account) {
  const r = await call(ctx, account, '/v2/activity/growth/buddy/info')
  if (!r.ok) return ['🐱 Buddy 信息查询失败']
  const d = r.data || {}
  const b = d.buddy && typeof d.buddy === 'object' ? d.buddy : d
  const name = b.name || '?'
  const parts = [b.rarity, b.personality].filter(Boolean).join(' · ')
  return ['🐱 Buddy: ' + name + (parts ? ' (' + parts + ')' : '')]
}

/** 抽奖：chances 优先，summary 兜底；按次数抽完并识别实物奖 */
async function lottery(ctx, account) {
  let chances = 0
  const c = await call(ctx, account, '/v2/activity/growth/lottery/chances')
  if (c.ok) chances = Math.floor(Number(pick(c.data, ['balance', 'chances', 'remaining']) || 0))
  if (!chances) {
    const s = await call(ctx, account, '/v2/activity/growth/lottery/summary')
    if (s.ok) chances = Math.floor(Number(pick(s.data, ['chances', 'balance']) || 0))
  }
  if (!chances || chances <= 0) return ['🎰 抽奖: 无次数']

  const cap = Math.min(envInt('WB_GAMES_MAX_DRAWS', 20), 50)
  const n = Math.min(chances, cap)
  const won = []
  for (let i = 0; i < n; i++) {
    if (i > 0) await ctx.http.sleep(2000)
    const r = await call(ctx, account, '/v2/activity/growth/lottery/draw', {
      method: 'POST', body: { client_token: 'draw-' + crypto.randomUUID() },
    })
    if (!r.ok) break
    const d = r.data || {}
    let prize = String(pick(d, ['prize_name', 'name']) || '?')
    if (d.prize_type === 'physical') prize += '（实物奖，请在成长中心填写收货地址）'
    won.push(prize)
  }
  const extra = chances > n ? '（上限保护，剩余 ' + (chances - n) + ' 次下轮再抽）' : ''
  return ['🎰 抽奖: ' + (won.length ? won.join('、') : '无结果') + extra]
}

/** 主入口：返回报告明细数组，不抛异常 */
async function run(ctx, account) {
  const chosen = selected(ctx)
  if (!chosen.length) return ['🎮 玩法已开启但全部被过滤']
  const details = ['🎮 互动玩法: ' + chosen.join('、')]
  if (NOT_INTEGRATED.length) {
    details.push('ℹ️ 未集成（端点待核实）: ' + NOT_INTEGRATED.join('、'))
  }

  // 顺序对齐上游：旅行前置 → 盲盒 → 派出 → Buddy 信息 → 抽奖
  let travelState = null
  if (chosen.includes('travel') || chosen.includes('blindbox')) {
    // 只开盲盒、不开旅行时做只读探测：拿到状态但绝不领奖（对齐上游 t_travel_probe）
    const withClaim = chosen.includes('travel')
    try {
      travelState = await travelPrepare(ctx, account, { claimArrived: withClaim })
      details.push(...travelState.notes)
    } catch (e) { details.push('⚠️ 旅行前置异常: ' + ctx.http.truncate(e.message, 80)) }
  }
  if (chosen.includes('blindbox')) {
    try { details.push(...await blindbox(ctx, account, travelState)) }
    catch (e) { details.push('⚠️ 盲盒异常: ' + ctx.http.truncate(e.message, 80)) }
  }
  if (chosen.includes('travel') && travelState) {
    try { details.push(...await travelDepart(ctx, account, travelState)) }
    catch (e) { details.push('⚠️ 派出异常: ' + ctx.http.truncate(e.message, 80)) }
  }
  if (chosen.includes('buddy_info')) {
    try { details.push(...await buddyInfo(ctx, account)) }
    catch (e) { details.push('⚠️ Buddy 信息异常: ' + ctx.http.truncate(e.message, 80)) }
  }
  if (chosen.includes('lottery')) {
    try { details.push(...await lottery(ctx, account)) }
    catch (e) { details.push('⚠️ 抽奖异常: ' + ctx.http.truncate(e.message, 80)) }
  }
  return details
}

module.exports = { STATE_FILE, INTEGRATED, NOT_INTEGRATED, enabled, selected, bases, dig, call, run, travelPrepare, blindbox, travelDepart, buddyInfo, lottery }
