/**
 * 三合一签到主入口：TRAE + WorkBuddy + Qoder
 *
 * 青龙定时任务：task checkin.js（旧的 task checkin_all.js 仍然可用）
 * 兼容：所有旧环境变量、QD 模板、失败时 exit 1 的语义。
 */
'use strict'

const path = require('path')
const http = require('./lib/http')
const env = require('./lib/env')
const state = require('./lib/state')
const notify = require('./lib/notify')
const report = require('./lib/report')
const localCreds = require('./lib/credentials')
const platforms = require('./platforms')

const HELP = `
🔔 三合一签到脚本 - TRAE + WorkBuddy + Qoder（零依赖 Node.js）

用法:
  node checkin.js                              全平台全流程
  node checkin.js --only workbuddy            只跑指定平台 (trae,workbuddy,qoder)
  node checkin.js --gap 2                    账号间隔秒数（默认 3）
  node checkin.js --dry-run                   只打印计划，不发任何写请求
  node checkin.js --refresh                   仅刷新 WorkBuddy 令牌
  node checkin.js --query                     仅只读查询积分/用量/连签
  node checkin.js --sign-retry-only           仅处理 WorkBuddy 补签队列
  node checkin.js --tasks a,b --skip-tasks c  任务白/黑名单
  node checkin.js --notify always|fail|0      推送策略
  node checkin.js --state-dir /ql/data        状态文件目录
  node checkin.js --activity-confirm          开启 WorkBuddy 活跃上报与热力图回读
  node checkin.js --growth-write              开启成长任务写操作（默认只读发现）
  node checkin.js --games                     开启互动玩法（抽奖/盲盒/Buddy/猫猫旅行）
  node checkin.js --games-tasks lottery,travel          只跑指定玩法
  node checkin.js --games-skip lottery                 跳过指定玩法

本地凭证: 环境变量为空时自动读取 trae-credentials.json / workbuddy-credentials.json /
          qoder-credentials.json / wb_login_result.json；LOCAL_CREDS=0 可关闭
环境变量模板见 env.template/ ，完整说明见 README.md
`

function aliasOf(name) {
  const n = name.toLowerCase()
  if (['wb', 'workbuddy', 'work', 'w'].includes(n)) return 'workbuddy'
  if (['tr', 'trae', 't'].includes(n)) return 'trae'
  if (['qd', 'qoder', 'q'].includes(n)) return 'qoder'
  return n
}

async function main() {
  const args = env.parseArgs()
  if (args.help) { console.log(HELP); return 0 }

  console.log('🔔 三合一签到脚本 - TRAE + WorkBuddy + Qoder')
  console.log('⏰ 执行时间: ' + env.formatBeijing())
  if (args.dryRun) console.log('🧪 DRY-RUN 模式：不会发送任何写请求')
  console.log()

  // 本机测试便利：环境变量为空时，回退读取工作目录下的本地凭证文件
  const loaded = localCreds.loadLocalCredentials({
    dir: process.cwd(),
    enabled: env.envStr('LOCAL_CREDS', '1') !== '0',
  })
  if (loaded.loaded.length) {
    console.log('📂 已从本地凭证文件加载（文件均已被 .gitignore 屏蔽）:')
    for (const x of loaded.loaded) {
      console.log('   · ' + x.env + ' ← ' + x.file + '（' + x.count + ' 个账号）')
    }
    console.log()
  }

  const stateDir = path.resolve(args.stateDir || env.getStateDir())
  const gapSec = args.gapSec != null ? args.gapSec : env.envInt('WB_GAP', 3)
  const ctx = {
    http, env, state, notify, report, args, stateDir,
    gapMs: Math.max(1, gapSec) * 1000,
  }

  const configured = platforms.filter((p) => p.detect())
  const missing = platforms.filter((p) => !p.detect())
  if (missing.length) {
    console.log('ℹ️ 未配置（跳过）: ' + missing.map((p) => p.name + ' [' + (p.envs || []).join('|') + ']').join('、'))
  }
  if (!configured.length) {
    const msg = '未设置任何环境变量\n请至少配置 TRAE_CREDENTIALS / WORKBUDDY_CREDENTIALS / WORKBUDDY_REFRESH_TOKEN / QODER_CREDENTIALS 之一'
    await notify.sendQinglong('三合一签到 - 配置错误', msg)
    return 1
  }

  // --refresh / --query / --sign-retry-only 是 WorkBuddy 专属模式
  const wbOnlyMode = args.refresh || args.query || args.signRetryOnly
  let selected = configured
  if (wbOnlyMode) {
    selected = configured.filter((p) => p.name === 'WorkBuddy')
    if (!selected.length) {
      console.log('⚠️ --refresh / --query / --sign-retry-only 需要配置 WorkBuddy 账号')
      return 1
    }
  } else if (args.only.length) {
    const wanted = args.only.map(aliasOf)
    selected = configured.filter((p) => wanted.includes(p.name.toLowerCase()))
  }
  if (!selected.length) {
    console.log('⚠️ --only 指定的平台未配置任何账号: ' + args.only.join(','))
    return 0
  }

  console.log('🎯 本次执行: ' + selected.map((p) => p.name).join('、'))
  const gamesOn = args.games || env.envBool('WB_GAMES')
  const wbSelected = selected.some((p) => p.name === 'WorkBuddy')
  if (gamesOn && !wbSelected) {
    console.log('⚠️ 已开启互动玩法（--games / WB_GAMES），但本次未执行 WorkBuddy，玩法不会运行')
  }
  if (wbSelected && !gamesOn) {
    console.log('ℹ️ 互动玩法默认关闭，需 WB_GAMES=1 或 --games 才会执行')
  }

  const results = []
  for (const p of selected) {
    try {
      const rows = await p.run(ctx)
      results.push(...(rows || []))
    } catch (e) {
      console.log('\n  ⚠️ ' + p.name + ' 签到整体异常: ' + http.truncate(e.message))
      results.push({ platform: p.name, name: '整体异常', success: false, message: e.message })
    }
    console.log()
  }

  const failList = results.filter((r) => !r.success)
  const successList = results.filter((r) => r.success && r.message !== '今日已签到')
  const summary = args.dryRun
    ? '🧪 DRY-RUN 预演完成 · ' + env.formatBeijing() + '\n\n已加载 ' + selected.length + ' 个平台，未发送任何请求。\n去掉 --dry-run 即执行真实签到。'
    : report.buildReport(results)
  console.log(summary)

  const title = failList.length
    ? '三合一签到 - ' + failList.length + ' 个失败'
    : (successList.length ? '三合一签到 - 全部成功' : '三合一签到 - 今日已全部签到')

  if (!args.dryRun && results.length) {
    await notify.notifyAll(title, summary, ctx, { hasFailure: failList.length > 0 })
  }
  return failList.length > 0 ? 1 : 0
}

main().then((code) => process.exit(code)).catch(async (e) => {
  console.error('💥 脚本异常:', e)
  await notify.sendQinglong('三合一签到 - 脚本异常', String(e.message || e))
  process.exit(1)
})
