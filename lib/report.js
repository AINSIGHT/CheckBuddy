/** 中文汇总报告：按平台/账号分块，附加积分、连签与待办分布 */
'use strict'

const { formatBeijing } = require('./env')

function pointsOf(r) {
  if (r.points != null) return ' (+' + r.points + ')'
  if (r.credit != null) return ' (+' + r.credit + ' 积分)'
  if (r.credits != null) return ' (+' + r.credits + ' Credits)'
  return ''
}

function buildReport(results, { beijingTime = true } = {}) {
  // skipped：平台/账号当前没有可领取的活动（如国际版无每日签到），既不算成功也不算失败
  const skippedList = results.filter((r) => r.skipped)
  const successList = results.filter((r) => r.success && !r.skipped && r.message !== '今日已签到')
  const alreadyList = results.filter((r) => r.success && !r.skipped && r.message === '今日已签到')
  const failList = results.filter((r) => !r.success && !r.skipped)

  const lines = []
  const byPlatform = new Map()
  for (const r of results) {
    if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, [])
    byPlatform.get(r.platform).push(r)
  }
  for (const [platform, rows] of byPlatform) {
    lines.push('【' + platform + '】')
    for (const r of rows) {
      const icon = r.skipped ? '⏭' : (r.success ? '✅' : '❌')
      const streak = r.streakDays != null ? ' 连' + r.streakDays + '天' : ''
      lines.push('  ' + icon + ' ' + r.name + ': ' + r.message + pointsOf(r) + streak)
      if (r.details && r.details.length) {
        for (const d of r.details) lines.push('     · ' + d)
      }
    }
  }

  const time = beijingTime ? formatBeijing() : new Date().toLocaleString('zh-CN')
  const head = '📊 签到汇总 · ' + time
  const tail = '\n\n成功: ' + successList.length + ' | 已签: ' + alreadyList.length +
    (skippedList.length ? ' | 跳过: ' + skippedList.length : '') +
    ' | 失败: ' + failList.length

  if (failList.length) {
    lines.push('')
    lines.push('⚠️ 待办：')
    for (const r of failList) lines.push('  · ' + r.platform + ' / ' + r.name + ' — ' + r.message)
  }

  return head + '\n\n' + (lines.length ? lines.join('\n') : '（没有可运行的账号，请检查环境变量）') + tail
}

module.exports = { buildReport }
