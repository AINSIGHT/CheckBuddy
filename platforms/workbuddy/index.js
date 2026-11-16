/**
 * WorkBuddy 平台编排：归一化 → 体检 → 续期 → 签到/查询/补签 → 报告明细。
 * 单账号异常只跳过该账号，不中断整轮。
 */
'use strict'

const creds = require('./credentials')
const refresh = require('./refresh')
const wbCheckin = require('./checkin')
const signRetry = require('./sign-retry')
const query = require('./query')
const activity = require('./activity')
const growth = require('./growth')
const games = require('./games')

function modeOf(ctx) {
  if (ctx.args.refresh) return 'refresh'
  if (ctx.args.query) return 'query'
  if (ctx.args.signRetryOnly) return 'sign-retry'
  return 'full'
}

async function ensureValid(ctx, account, { force = false } = {}) {
  if (!account.refreshable) return null
  if (!refresh.needRefresh(account, { force })) return null
  console.log('    🔄 Token 续期中...')
  const r = await refresh.refreshAccount(ctx, account, { force })
  console.log('    ' + (r.ok ? '✅ ' : '⚠️ ') + r.message + (r.ok && r.rotated ? '（RT 已轮换并写回）' : ''))
  return r
}

async function run(ctx) {
  const accounts = creds.loadAccounts(ctx)
  if (!accounts.length) return []

  const mode = modeOf(ctx)
  console.log('━'.repeat(60))
  console.log('🚀 WorkBuddy - 共 ' + accounts.length + ' 个账号 | 模式: ' + mode)
  console.log('━'.repeat(60))
  if (ctx.args.dryRun) {
    console.log('    [DRY-RUN] 账号清单（不发任何请求）:')
    for (const a of accounts) {
      console.log('      · ' + a.name + ' | AT:' + (a.at ? '有' : '无') + ' | RT:' + (a.rt ? '有（可永续）' : '无（只读模式）'))
    }
    return []
  }

  const results = []
  if (mode === 'sign-retry') {
    for (const a of accounts) { try { await ensureValid(ctx, a) } catch (e) { console.log('    ⚠️ ' + e.message) } }
    return await signRetry.processQueue(ctx, accounts)
  }

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]
    console.log('\n  [' + (i + 1) + '/' + accounts.length + '] ' + account.name)
    try {
      const inspection = creds.inspectCredential(account)
      for (const p of inspection.problems) console.log('    ⚠️ 凭据体检: ' + p)
      for (const w of inspection.warnings) console.log('    ℹ️ ' + w)

      const rr = await ensureValid(ctx, account, { force: mode === 'refresh' })
      if (mode === 'refresh') {
        if (!account.refreshable) {
          results.push({ platform: 'WorkBuddy', name: account.name, success: true, message: '未配置 RT，跳过续期', details: ['建议用 node tools/workbuddy-login.cjs 获取 手机号:AT:RT'] })
        } else {
          results.push({ platform: 'WorkBuddy', name: account.name, success: !!rr && rr.ok, message: (rr && rr.message) || '续期未执行', details: [] })
        }
        continue
      }
      if (rr && !rr.ok && !account.at) {
        results.push({ platform: 'WorkBuddy', name: account.name, success: false, message: rr.message, details: ['无可用 AT，且续期失败，请重新登录'] })
        continue
      }

      if (mode === 'query') {
        const details = await query.queryAll(ctx, account)
        if (growth.shouldRun(ctx)) details.push(...await growth.discover(ctx, account))
        results.push({ platform: 'WorkBuddy', name: account.name, success: true, message: '查询完成', details })
        console.log('    ✅ 查询完成' + (details.length ? '（' + details.length + ' 条）' : ''))
        continue
      }

      let r = await wbCheckin.runCheckin(ctx, account)
      // 运行中 401：用该账号 RT 续期一次并重试
      if (r.kind === 'unauthorized' && account.refreshable) {
        const again = await refresh.refreshAccount(ctx, account, { force: true })
        if (again.ok) { console.log('    🔄 401 后续期成功，重试签到'); r = await wbCheckin.runCheckin(ctx, account) }
      }
      if (r.kind === 'retryable') {
        await signRetry.enqueue(ctx, account)
        r.details = (r.details || []).concat('已加入 10/40 分钟补签队列（可用 --sign-retry-only 触发）')
        r.message = '签到瞬时失败: ' + r.message
      }

      const row = {
        platform: 'WorkBuddy', name: account.name, success: r.success, message: r.message,
        credit: r.credit, streakDays: r.streakDays, details: r.details || [],
      }
      if (!['enterprise', 'restricted', 'inactive'].includes(r.kind)) {
        try { row.details.push(...await query.queryAll(ctx, account)) } catch { /* 只读查询失败不影响结果 */ }
        try { row.details.push(...(await activity.confirmActivity(ctx, account)).details) } catch { /* ignore */ }
        // 玩法是写操作：仅在签到成功且显式开启时执行，失败只记明细不影响签到结果
        if (r.success && games.enabled(ctx)) {
          try { row.details.push(...await games.run(ctx, account)) }
          catch (e) { row.details.push('⚠️ 互动玩法异常: ' + ctx.http.truncate(e.message, 80)) }
        }
        if (growth.shouldRun(ctx)) {
          try { row.details.push(...await growth.discover(ctx, account)) } catch (e) { row.details.push('⚠️ 成长任务发现失败: ' + ctx.http.truncate(e.message, 80)) }
        }
      }
      results.push(row)
      const credit = row.credit != null ? ' (+' + row.credit + '积分)' : ''
      const streak = row.streakDays != null ? ' (签到连签' + row.streakDays + '天)' : ''
      console.log('    ' + (row.success ? '✅ ' : '❌ ') + row.message + credit + streak)
      for (const d of row.details) console.log('       · ' + d)
    } catch (e) {
      results.push({ platform: 'WorkBuddy', name: account.name, success: false, message: e.message, details: [] })
      console.log('    ❌ ' + ctx.http.truncate(e.message))
    }
    if (i < accounts.length - 1) await ctx.http.sleep(ctx.gapMs)
  }
  return results
}

module.exports = {
  name: 'WorkBuddy',
  envs: ['WORKBUDDY_CREDENTIALS', 'WORKBUDDY_REFRESH_TOKEN'],
  detect: () => !!(process.env.WORKBUDDY_CREDENTIALS || process.env.WORKBUDDY_REFRESH_TOKEN),
  run,
}
