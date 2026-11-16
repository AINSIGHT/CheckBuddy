/** 环境变量、命令行参数与北京时间的统一入口 */
'use strict'

const path = require('path')

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

function envStr(name, fallback = '') {
  const v = process.env[name]
  return v === undefined || v === null || v === '' ? fallback : String(v).trim()
}

function envBool(name, fallback = false) {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  return !['0', 'false', 'no', 'off', ''].includes(String(v).trim().toLowerCase())
}

function envInt(name, fallback) {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

function envList(name) {
  return envStr(name).split(/[,，、\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
}

function getStateDir() {
  const dir = envStr('STATE_DIR') || envStr('WB_STATE_DIR') || envStr('WORKBUDDY_STATE_DIR')
  return path.resolve(dir || path.join(__dirname, '..'))
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

function beijingNow() { return new Date(Date.now() + BEIJING_OFFSET_MS) }

function beijingToday() { return beijingNow().toISOString().slice(0, 10) }

function formatBeijing(date = new Date()) {
  return new Date(date.getTime() + BEIJING_OFFSET_MS)
    .toISOString().replace('T', ' ').slice(0, 19) + ' (北京时间)'
}

/**
 * 解析命令行参数。未知参数忽略，避免青龙等环境传入额外参数时报错。
 */
function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    only: [], tasks: [], skipTasks: [], gapSec: null, notify: null,
    dryRun: false, refresh: false, query: false, signRetryOnly: false,
    stateDir: null, activityConfirm: null, growthWrite: null, help: false,
    games: false, gamesTasks: [], gamesSkip: [],
  }
  const valueOf = (i) => (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '')
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only' || a.startsWith('--only=')) args.only = (a.includes('=') ? a.split('=')[1] : valueOf(i)).split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    else if (a === '--tasks' || a.startsWith('--tasks=')) args.tasks = (a.includes('=') ? a.split('=')[1] : valueOf(i)).split(/[,，、\s]+/).filter(Boolean)
    else if (a === '--skip-tasks' || a.startsWith('--skip-tasks=')) args.skipTasks = (a.includes('=') ? a.split('=')[1] : valueOf(i)).split(/[,，、\s]+/).filter(Boolean)
    else if (a === '--gap' || a.startsWith('--gap=')) args.gapSec = Number(a.includes('=') ? a.split('=')[1] : valueOf(i)) || null
    else if (a === '--notify' || a.startsWith('--notify=')) args.notify = a.includes('=') ? a.split('=')[1] : valueOf(i)
    else if (a === '--state-dir' || a.startsWith('--state-dir=')) args.stateDir = a.includes('=') ? a.split('=')[1] : valueOf(i)
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--refresh') args.refresh = true
    else if (a === '--query') args.query = true
    else if (a === '--sign-retry-only') args.signRetryOnly = true
    else if (a === '--activity-confirm') args.activityConfirm = true
    else if (a === '--growth-write') args.growthWrite = true
    else if (a === '--games') args.games = true
    else if (a === '--games-tasks' || a.startsWith('--games-tasks=')) args.gamesTasks = (a.includes('=') ? a.split('=')[1] : valueOf(i)).split(/[,，、\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    else if (a === '--games-skip' || a.startsWith('--games-skip=')) args.gamesSkip = (a.includes('=') ? a.split('=')[1] : valueOf(i)).split(/[,，、\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

module.exports = {
  parseEnvJson, envStr, envBool, envInt, envList, getStateDir,
  beijingNow, beijingToday, formatBeijing, parseArgs,
}
