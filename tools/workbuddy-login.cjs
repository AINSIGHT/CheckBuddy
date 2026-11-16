/**
 * WorkBuddy 短信验证码登录工具（多账号版）
 *
 *   node tools/workbuddy-login.cjs                       交互式，可连续添加多个账号
 *   node tools/workbuddy-login.cjs 13800000000           指定手机号（单账号模式）
 *   node tools/workbuddy-login.cjs 13800000000 123456    指定手机号 + 验证码
 *   node tools/workbuddy-login.cjs --check               登录后额外用只读接口验证 AT
 *   node tools/workbuddy-login.cjs --list                列出已保存账号（脱敏，不打印 token）
 *   node tools/workbuddy-login.cjs --export              输出完整多行 WORKBUDDY_REFRESH_TOKEN
 *   node tools/workbuddy-login.cjs --remove 13800000000 删除指定账号
 *   node tools/workbuddy-login.cjs --clear               清空全部（需确认，--yes 跳过）
 *
 * 多账号规则：按手机号 upsert —— 重复登录同一手机号会覆盖旧条目，不会重复签到；
 *            文件为 JSON 数组，主脚本会把所有 env_line 拼成多行环境变量。
 * 结果文件：当前工作目录下 wb_login_result.json（与主脚本读取目录一致），0600 权限。
 *
 * 与上游实现的区别（刻意修正的四个坑）：
 *   1. 保留 TLS 证书校验（不使用 verify=False / rejectUnauthorized:false）；
 *   2. --check 只调只读查询接口验 AT，绝不触发刷新端点，避免轮换后丢弃新 RT；
 *   3. 结果文件用文件锁 + 原子写，并以 0600 权限保存；
 *   4. 请求头统一由 headers() 生成，发送短信/换取令牌/校验使用同一套指纹。
 */
'use strict'

const path = require('path')
const readline = require('readline')
const { request } = require('../lib/http')
const { atomicReadJSON, atomicWriteJSON, withLock } = require('../lib/state')
const { decodeJwt } = require('../platforms/workbuddy/credentials')

const BASE = 'https://www.workbuddy.cn'
const SEND_SMS_URL = BASE + '/v2/plugin/login/send-sms'
const LOGIN_URL = BASE + '/v2/plugin/login/token'
const CHECK_URL = 'https://www.codebuddy.cn/billing/meter/get-user-resource-summary'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

function resultFile(dir = process.cwd()) {
  return path.join(dir, 'wb_login_result.json')
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: BASE,
    Referer: BASE + '/',
    'User-Agent': UA,
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => { rl.close(); resolve(String(answer || '').trim()) })
  })
}

function maskPhone(p) {
  const s = String(p || '')
  return s.length > 7 ? s.slice(0, 3) + '****' + s.slice(-4) : '***'
}

// ---------------------------------------------------------------- 凭证库读写

function readAll(dir = process.cwd()) {
  const data = atomicReadJSON(resultFile(dir), [])
  const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : [])
  // 按手机号折叠历史重复条目（保留最后一条最新凭据），list/export/upsert 都基于干净数据
  const map = new Map()
  arr.forEach((e) => {
    if (!e || typeof e !== 'object') return
    const parts = String(e.env_line || '').trim().split(':')
    const phone = String(e.phone || '') || (parts.length >= 3 ? parts[0] : '')
    if (!phone) return
    map.set(phone, e)
  })
  return [...map.values()]
}

async function writeAll(arr, dir = process.cwd()) {
  const file = resultFile(dir)
  await withLock(file, async () => atomicWriteJSON(file, arr, { mode: 0o600 }))
}

/** 按手机号 upsert：重复登录同一账号覆盖旧条目，避免数组里出现两份 */
async function upsert(entry, dir = process.cwd()) {
  const file = resultFile(dir)
  await withLock(file, async () => {
    const arr = readAll(dir)
    const idx = arr.findIndex((x) => String((x && x.phone) || '') === String(entry.phone))
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...entry, login_at: arr[idx].login_at || entry.login_at }
    } else {
      arr.push(entry)
    }
    atomicWriteJSON(file, arr, { mode: 0o600 })
  })
  return readAll(dir)
}

function listAccounts(dir = process.cwd()) {
  const arr = readAll(dir)
  if (!arr.length) {
    console.log('📭 尚未保存任何 WorkBuddy 账号（' + resultFile(dir) + '）')
    return 0
  }
  console.log('📋 已保存 ' + arr.length + ' 个 WorkBuddy 账号：')
  arr.forEach((e, i) => {
    const jwt = decodeJwt(e.access_token || '') || {}
    const exp = jwt.exp ? new Date(jwt.exp * 1000).toISOString().replace('T', ' ').slice(0, 16) : '未知'
    const at = e.login_at ? String(e.login_at).replace('T', ' ').slice(0, 16) : '未知'
    console.log('  ' + String(i + 1).padStart(2) + '. ' + maskPhone(e.phone) +
      ' | AT 过期 ' + exp + ' | 登录 ' + at)
  })
  console.log('  ℹ️ --export 输出完整值 / --remove <手机号> 删除 / --clear 清空')
  return 0
}

function exportEnv(dir = process.cwd()) {
  const lines = readAll(dir).map((e) => {
    const line = String((e && e.env_line) || '').trim()
    if (line) return line
    if (e && e.phone && e.refresh_token) return e.phone + ':' + (e.access_token || '') + ':' + e.refresh_token
    return ''
  }).filter((line) => line.split(':').length >= 3)
  if (!lines.length) {
    console.log('📭 无账号可导出，请先运行 npm run login:workbuddy')
    return 1
  }
  console.log('═'.repeat(60))
  console.log('✅ 复制下面全部内容到 WORKBUDDY_REFRESH_TOKEN（' + lines.length + ' 个账号，换行分隔）')
  console.log('═'.repeat(60))
  console.log(lines.join('\n'))
  console.log('═'.repeat(60))
  return 0
}

async function removeAccount(phone, dir = process.cwd()) {
  const before = readAll(dir)
  const after = before.filter((e) => String((e && e.phone) || '') !== String(phone))
  if (after.length === before.length) {
    console.log('⚠️ 未找到账号: ' + maskPhone(phone))
    return 1
  }
  await writeAll(after, dir)
  console.log('🗑️ 已删除 ' + maskPhone(phone) + '，剩余 ' + after.length + ' 个账号')
  return 0
}

async function clearAll(dir = process.cwd(), assumeYes = false) {
  const arr = readAll(dir)
  if (!arr.length) {
    console.log('📭 无账号可清空')
    return 0
  }
  if (!assumeYes) {
    const ans = await ask('⚠️ 确认清空 ' + arr.length + ' 个账号？输入 yes 继续: ')
    if (ans.toLowerCase() !== 'yes') {
      console.log('已取消')
      return 0
    }
  }
  await writeAll([], dir)
  console.log('🗑️ 已清空，剩余 0 个账号')
  return 0
}

// ---------------------------------------------------------------- 登录流程

async function sendSms(phone) {
  const resp = await request('POST', SEND_SMS_URL, { headers: headers(), body: { phone }, timeout: 20000 })
  const d = resp.data
  if (!d || d.code !== 0) throw new Error('验证码发送失败: ' + ((d && (d.msg || d.message)) || 'HTTP ' + resp.status))
  const exp = (d.data && d.data.expires_in) || 300
  console.log('  ✅ 验证码已发送（有效期 ' + exp + ' 秒）')
}

async function exchangeToken(phone, code) {
  const resp = await request('POST', LOGIN_URL, {
    headers: headers(),
    body: { login_method: 'phone', phone, sms_code: code },
    timeout: 30000,
  })
  const d = resp.data
  if (!d || d.code !== 0) throw new Error('登录失败: ' + ((d && (d.msg || d.message)) || 'HTTP ' + resp.status))
  const data = d.data || {}
  const at = data.accessToken || data.access_token || ''
  const rt = data.refreshToken || data.refresh_token || ''
  if (!at || !rt) {
    throw new Error('登录回执缺少 accessToken/refreshToken: ' + JSON.stringify(data).slice(0, 200))
  }
  return { at, rt }
}

/** 只读校验：不触碰刷新端点，因此不会让刚拿到的 RT 失效 */
async function checkAt(at) {
  const resp = await request('POST', CHECK_URL, {
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: {}, timeout: 20000,
  })
  return resp.status < 400 && resp.data && typeof resp.data === 'object'
}

async function loginOne(phone, code, doCheck, dir) {
  if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确: ' + phone)
  if (!code) {
    await sendSms(phone)
    code = await ask('  📱 请输入收到的验证码: ')
  }
  if (!code) throw new Error('未提供验证码')

  console.log('  ⏳ 提交登录...')
  const { at, rt } = await exchangeToken(phone, code)
  const jwt = decodeJwt(at) || {}
  const exp = jwt.exp ? new Date(jwt.exp * 1000).toISOString().replace('T', ' ').slice(0, 16) : '未知'
  console.log('  ✅ 登录成功 | ' + maskPhone(phone) + ' | AT 过期: ' + exp)

  if (doCheck) {
    const ok = await checkAt(at)
    console.log('  ' + (ok ? '✅ 只读接口校验通过（AT 可用）' : '⚠️ 只读接口未通过，请确认 AT 是否有效'))
  }

  const entry = {
    phone, access_token: at, refresh_token: rt,
    env_line: phone + ':' + at + ':' + rt,
    login_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const arr = await upsert(entry, dir)
  console.log('  💾 已保存，当前共 ' + arr.length + ' 个账号（同手机号自动覆盖）')
  return arr
}

/** 交互式批量：连续登录多个手机号，回车或 N 结束 */
async function interactiveLoop(doCheck, dir) {
  for (;;) {
    const phone = await ask('\n  📱 手机号（直接回车结束）: ')
    if (!phone) break
    if (!/^1\d{10}$/.test(phone)) {
      console.log('  ⚠️ 手机号格式不正确，请重试')
      continue
    }
    try {
      await loginOne(phone, '', doCheck, dir)
    } catch (e) {
      console.log('  ❌ ' + e.message + '（可继续添加其他账号）')
    }
    const more = await ask('  ➕ 继续添加下一个账号？(y/N): ')
    if (!/^y(es)?$/i.test(more)) break
  }
}

function printSaved(arr) {
  console.log('\n' + '═'.repeat(60))
  console.log('💾 已保存 ' + arr.length + ' 个 WorkBuddy 账号')
  console.log('═'.repeat(60))
  console.log('📁 ' + resultFile())
  console.log('ℹ️  本机直接运行 node checkin.js 会自动加载全部账号')
  console.log('ℹ️  青龙 / Actions 请执行 npm run login:workbuddy -- --export 复制完整多行值')
  console.log('ℹ️  管理：--list 查看 / --remove <手机号> 删除 / --clear 清空')
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const positional = argv.filter((a) => !a.startsWith('--'))
  const doCheck = flags.has('--check')
  const dir = process.cwd()

  // 管理命令（不发短信）
  if (flags.has('--list')) return listAccounts(dir)
  if (flags.has('--export')) return exportEnv(dir)
  if (flags.has('--remove')) {
    const phone = positional[0]
    if (!phone) throw new Error('--remove 需要手机号，例如 --remove 13800000000')
    return removeAccount(phone, dir)
  }
  if (flags.has('--clear')) return clearAll(dir, flags.has('--yes'))

  console.log('╔══════════════════════════════════════════════╗')
  console.log('║ 🔐 WorkBuddy 短信验证码登录工具 (多账号版)     ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log('  ✅ 目标: ' + BASE)
  console.log('  📁 凭证库: ' + resultFile(dir))

  const phone = positional[0] || ''
  const code = positional[1] || ''
  let arr
  if (phone) {
    // 单账号模式（兼容旧用法，指定手机号+验证码时无需交互）
    arr = await loginOne(phone, code, doCheck, dir)
  } else {
    console.log('  ℹ️ 多账号模式：可连续登录多个手机号，直接回车结束')
    await interactiveLoop(doCheck, dir)
    arr = readAll(dir)
  }
  printSaved(arr)
  return 0
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c }).catch((e) => {
    console.error('  ❌ ' + e.message)
    process.exitCode = 1
  })
}

module.exports = {
  resultFile, readAll, writeAll, upsert, maskPhone,
  listAccounts, exportEnv, removeAccount, clearAll, loginOne,
}
