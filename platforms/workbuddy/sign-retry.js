/**
 * 分钟级补签队列：仅 500 + code=10001 + 「稍后重试」入队，第 10 / 40 分钟各补一次。
 * 状态文件只保存 UID 哈希，不保存凭据、手机号或账号标识。
 */
'use strict'

const { atomicReadJSON, atomicWriteJSON, withLock, statePath } = require('../../lib/state')
const { envInt } = require('../../lib/env')
const { getCheckinStatus, checkedState, signOnce } = require('./checkin')

const QUEUE_FILE = 'wb_sign_retry.json'
const RETRY_MINUTES = [10, 40]

function read(ctx) {
  const q = atomicReadJSON(statePath(ctx.stateDir, QUEUE_FILE), { version: 1, items: {} })
  return q && q.items ? q : { version: 1, items: {} }
}

function write(ctx, q) {
  atomicWriteJSON(statePath(ctx.stateDir, QUEUE_FILE), q)
}

async function enqueue(ctx, account) {
  const file = statePath(ctx.stateDir, QUEUE_FILE)
  await withLock(file, async () => {
    const q = read(ctx)
    if (!q.items[account.key]) q.items[account.key] = { firstFailAt: Date.now(), tried: [] }
    write(ctx, q)
  })
}

async function clear(ctx, key) {
  const file = statePath(ctx.stateDir, QUEUE_FILE)
  await withLock(file, async () => {
    const q = read(ctx)
    if (q.items[key]) { delete q.items[key]; write(ctx, q) }
  })
}

/** 返回本轮补签产生的结果行 */
async function processQueue(ctx, accounts) {
  const q = read(ctx)
  const keys = Object.keys(q.items || {})
  if (!keys.length) {
    console.log('  ℹ️ 补签队列为空')
    return []
  }
  const max = Math.min(envInt('WB_MAKEUP_MAX_PER_RUN', 1), 10)
  const results = []
  let used = 0

  for (const key of keys) {
    const item = q.items[key]
    const due = RETRY_MINUTES.find((m) => !(item.tried || []).includes(m) && Date.now() >= item.firstFailAt + m * 60000)
    if (!due) continue
    if (used >= max) break
    used++

    const account = accounts.find((a) => a.key === key)
    if (!account) { await clear(ctx, key); continue }

    console.log('  🩹 补签尝试 +' + due + '分钟: ' + account.name)
    // 每次先查官方状态，已签立即清队列
    const status = await getCheckinStatus(ctx, account)
    if (status && checkedState(status) === true) {
      await clear(ctx, key)
      results.push({ platform: 'WorkBuddy', name: account.name, success: true, message: '补签前复查：今日已签到', details: [] })
      continue
    }

    const r = await signOnce(ctx, account)
    item.tried = item.tried || []
    item.tried.push(due)
    if (r.success) {
      await clear(ctx, key)
      results.push({ platform: 'WorkBuddy', name: account.name, success: true, message: '补签成功', credit: r.credit, streakDays: r.streakDays, details: r.details || [] })
    } else if (r.kind === 'retryable') {
      if (item.tried.length >= RETRY_MINUTES.length) await clear(ctx, key)
      else {
        const file = statePath(ctx.stateDir, QUEUE_FILE)
        await withLock(file, async () => { const cur = read(ctx); if (cur.items[key]) { cur.items[key] = item; write(ctx, cur) } })
      }
      results.push({ platform: 'WorkBuddy', name: account.name, success: false, message: '补签仍为瞬时失败: ' + r.message, details: [] })
    } else {
      await clear(ctx, key)
      results.push({ platform: 'WorkBuddy', name: account.name, success: false, message: '补签失败: ' + r.message, details: [] })
    }
  }
  return results
}

module.exports = { QUEUE_FILE, enqueue, clear, processQueue }
