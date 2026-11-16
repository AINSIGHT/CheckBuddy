/**
 * 成长任务：默认只读发现（三源合并、未适配提示、到期提醒）。
 * 写操作（accept / claim）必须显式开启 WB_GROWTH_WRITE=1 或 --growth-write。
 */
'use strict'

const creds = require('./credentials')
const { envBool, envList, envStr } = require('../../lib/env')

const KNOWN = {
  first_buddy: '领取 Buddy', Sequential_Tasks_1: '链式任务1·完成1次对话',
  Sequential_Tasks_2: '链式任务2·专家对话', Sequential_Tasks_3: '链式任务3·完成5次对话',
  Sequential_Tasks_4: '链式任务4·创建定时任务', Sequential_Tasks_5: '链式任务5·GLM5.2',
  Sequential_Tasks_6: '链式任务6·完成10次对话', Sequential_Tasks_7: '链式任务7·体验灵感',
  black_cat: '夜猫子活动', chat_5: '和AI聊天5次', expert_5: '召唤5次专家',
  template_used: '使用5个模板', skill_1: '尝鲜热门技能',
  wb_wechat_oa_subscribe_task: '关注公众号（需人工）',
}

function shouldRun(ctx) {
  return !!(ctx.args.query || ctx.args.growthWrite || ctx.args.tasks.length || ctx.args.skipTasks.length ||
    envBool('WB_GROWTH_DISCOVER') || envBool('WB_GROWTH_WRITE') ||
    envStr('WB_TASKS') || envStr('WB_SKIP_TASKS'))
}

function writeEnabled(ctx) {
  return !!(ctx.args.growthWrite || envBool('WB_GROWTH_WRITE'))
}

function filters(ctx) {
  const allow = ctx.args.tasks.length ? ctx.args.tasks : envList('WB_TASKS')
  const skip = ctx.args.skipTasks.length ? ctx.args.skipTasks : envList('WB_SKIP_TASKS')
  return { allow: allow.map((s) => s.toLowerCase()), skip: skip.map((s) => s.toLowerCase()) }
}

function rowsOf(d) {
  if (!d) return []
  const body = d.data && typeof d.data === 'object' ? d.data : d
  const list = Array.isArray(body) ? body : (body.tasks || body.list || body.items || body.data || [])
  return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []
}

async function fetchTasks(ctx, account) {
  const base = creds.baseUrls()[0]
  const sources = [
    { url: base + '/v2/activity/growth/tasks', extra: {} },
    { url: base + '/activity/growth/tasks', extra: {} },
    { url: base + '/v2/activity/growth/tasks', extra: { 'X-Client-Platform': 'miniprogram' } },
  ]
  const map = new Map()
  for (const s of sources) {
    try {
      const resp = await ctx.http.request('GET', s.url, {
        headers: creds.buildHeaders(account, s.extra), body: null, timeout: 20000,
      })
      for (const row of rowsOf(resp.data)) {
        const code = String(row.task_code || row.taskCode || row.code || '')
        if (!code) continue
        if (!map.has(code)) map.set(code, row)
      }
    } catch { /* 单一来源失败不影响其他来源 */ }
  }
  return [...map.values()]
}

function codeOf(row) { return String(row.task_code || row.taskCode || row.code || '') }

function isDone(row) {
  const p = row.progress || {}
  const cur = Number(p.current != null ? p.current : row.current)
  const target = Number(p.target != null ? p.target : row.target)
  return row.claimed === true || row.status === 'claimed' ||
    (Number.isFinite(cur) && Number.isFinite(target) && target > 0 && cur >= target)
}

async function writeActions(ctx, account, tasks, { allow, skip }) {
  const base = creds.baseUrls()[0]
  const details = []
  const picked = tasks.filter((t) => {
    const c = codeOf(t).toLowerCase()
    return (!allow.length || allow.includes(c)) && !skip.includes(c) && c !== 'wb_wechat_oa_subscribe_task'
  }).slice(0, 20)
  for (const t of picked) {
    const code = codeOf(t)
    try {
      const path = isDone(t)
        ? '/activity/growth/tasks/' + encodeURIComponent(code) + '/claim'
        : '/v2/activity/growth/tasks/accept'
      const body = isDone(t) ? {} : { task_codes: [code] }
      let resp = await ctx.http.request('POST', base + path, {
        headers: creds.buildHeaders(account), body, timeout: 20000,
      })
      if (resp.status === 400 && isDone(t)) {
        resp = await ctx.http.request('POST', base + path, {
          headers: creds.buildHeaders(account, { 'x-client-platform': 'web' }), body, timeout: 20000,
        })
      }
      const ok = resp.status < 400 && resp.data && (resp.data.code === 0 || resp.data.code === 200)
      details.push((ok ? '✅ ' : '⚠️ ') + (KNOWN[code] || code) + (isDone(t) ? ' 补领' : ' 登记') + (ok ? '' : ' 未成功'))
    } catch (e) {
      details.push('⚠️ ' + code + ' 写操作失败: ' + ctx.http.truncate(e.message, 60))
    }
    await ctx.http.sleep(1200)
  }
  return details
}

async function discover(ctx, account) {
  const tasks = await fetchTasks(ctx, account)
  if (!tasks.length) return ['🌱 成长任务清单为空（接口未下发或账号无成长体系）']
  const { allow, skip } = filters(ctx)
  const details = ['🌱 成长任务 ' + tasks.length + ' 项（桌面 / 等级族 / 小程序三源合并）']

  const unknown = tasks.filter((t) => !KNOWN[codeOf(t)]).map(codeOf)
  if (unknown.length) details.push('⚠️ 发现未适配的新任务: ' + unknown.slice(0, 8).join(', ') + (unknown.length > 8 ? ' …' : ''))

  const today = ctx.env.beijingToday()
  const expiring = tasks.filter((t) => {
    const end = t.valid_end || t.validEnd
    if (!end || isDone(t)) return false
    const d = String(end).slice(0, 10)
    const days = (Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000
    return Number.isFinite(days) && days <= 7
  })
  if (expiring.length) details.push('⏰ 即将到期/已过期未完成: ' + expiring.map(codeOf).slice(0, 6).join(', '))

  if (allow.length || skip.length) details.push('🎛️ 任务过滤: 白名单 ' + (allow.join(',') || '全部') + ' | 黑名单 ' + (skip.join(',') || '无'))
  if (writeEnabled(ctx)) {
    details.push('✍️ 已开启成长任务写操作')
    details.push(...await writeActions(ctx, account, tasks, { allow, skip }))
  } else {
    details.push('ℹ️ 成长任务为只读发现；如需 accept/claim 请设置 WB_GROWTH_WRITE=1')
  }
  return details
}

module.exports = { shouldRun, writeEnabled, discover }
