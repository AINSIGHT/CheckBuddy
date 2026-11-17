#!/usr/bin/env node
/**
 * Qoder UMID 设备身份提取（免抓包）
 * =====================================
 * 每日 100 Credits 活动只下发给带官方设备身份的请求，三件套
 * （machineToken / machineCode / machineType）由客户端自带的
 * runtime-info 组件生成 —— 直接调用它即可，无需抓包。
 *
 * 用法：
 *   node tools/qoder-umid.cjs                 # 中国版（UMID 环境 0）
 *   node tools/qoder-umid.cjs --global        # 国际版（UMID 环境 3）
 *   node tools/qoder-umid.cjs --global 12345  # 指定账号 uid（活动列表顶层 uid）
 *
 * 输出可直接粘贴进环境变量 / Secrets：
 *   QODER_MACHINE_TOKEN / QODER_MACHINE_CODE / QODER_MACHINE_TYPE
 *
 * 组件查找顺序（与上游 L0NE-6/Qoder-Daily 一致）：
 *   1. QODERCN_RUNTIME_INFO / QODER_RUNTIME_INFO / QODER_UMID_PATH 环境变量
 *   2. 本机客户端安装目录 resources/umid/runtime-info(.exe)
 */
'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const UMID_ENV = { cn: 0, global: 3 } // 上游实测：中国版 0，国际版客户端组件 3

function findRuntimeInfo(region) {
  const custom = process.env[region === 'cn' ? 'QODERCN_RUNTIME_INFO' : 'QODER_RUNTIME_INFO'] ||
    process.env.QODER_UMID_PATH
  if (custom && fs.existsSync(custom)) return custom
  const exe = 'runtime-info.exe'
  const roots = []
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const programs = path.join(localAppData, 'Programs')
  if (fs.existsSync(programs)) {
    for (const dir of fs.readdirSync(programs)) {
      if (/qoder/i.test(dir)) roots.push(path.join(programs, dir))
    }
  }
  // 官网默认安装也可能在LOCALAPPDATA 根
  for (const dir of fs.existsSync(localAppData) ? fs.readdirSync(localAppData) : []) {
    if (/^Qoder/i.test(dir)) roots.push(path.join(localAppData, dir))
  }
  for (const root of roots) {
    const candidate = path.join(root, 'resources', 'umid', exe)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function main() {
  const args = process.argv.slice(2)
  const region = args.includes('--global') ? 'global' : 'cn'
  const uid = args.find((a) => /^\d+$/.test(a)) || ''

  const exe = findRuntimeInfo(region)
  if (!exe) {
    console.error('[X] 未找到 runtime-info 组件。')
    console.error('    请先安装 Qoder ' + (region === 'cn' ? 'CN' : '') + ' 桌面客户端，')
    console.error('    或用 QODER_UMID_PATH 环境变量指定 runtime-info 路径。')
    process.exit(1)
  }
  console.log('[UMID] 组件: ' + exe + '（环境 ' + UMID_ENV[region] + '，地区 ' + region + '）')

  // Windows/macOS 需经 stdin 喂账号 JSON；Linux 直接参数调用
  let output = ''
  const stdioArgs = [String(UMID_ENV[region])]
  const input = JSON.stringify({ account: uid }) + '\n'
  if (process.platform === 'win32' || process.platform === 'darwin') {
    stdioArgs.push('--account-stdin')
    output = execFileSync(exe, stdioArgs, { input, encoding: 'utf8', timeout: 25000 })
  } else {
    output = execFileSync(exe, stdioArgs, { encoding: 'utf8', timeout: 25000 })
  }
  const line = String(output || '').split(/\r?\n/).find((l) => l.trim().startsWith('{'))
  if (!line) throw new Error('组件输出不含 JSON：' + String(output).slice(0, 200))
  const data = JSON.parse(line.trim())
  const values = {}
  for (const key of ['machineToken', 'machineCode', 'machineType']) {
    const v = typeof data[key] === 'string' ? data[key].trim() : ''
    if (!v || v.length > 4096) throw new Error('组件输出缺少 ' + key)
    values[key] = v
  }

  console.log('[UMID] 生成成功（token 仅打印前 12 位防泄露）')
  for (const [k, v] of Object.entries(values)) {
    console.log('  ' + k + ' = ' + v.slice(0, 12) + (v.length > 12 ? '...' : ''))
  }
  console.log('')
  console.log('─── 复制到环境变量（PowerShell）───')
  console.log('$env:QODER_MACHINE_TOKEN = "' + values.machineToken + '"')
  console.log('$env:QODER_MACHINE_CODE  = "' + values.machineCode + '"')
  console.log('$env:QODER_MACHINE_TYPE  = "' + values.machineType + '"')
  console.log('')
  console.log('─── 复制到环境变量（bash / 青龙 export）───')
  console.log("export QODER_MACHINE_TOKEN='" + values.machineToken + "'")
  console.log("export QODER_MACHINE_CODE='" + values.machineCode + "'")
  console.log("export QODER_MACHINE_TYPE='" + values.machineType + "'")
}

try {
  main()
} catch (e) {
  console.error('[X] UMID 生成失败: ' + e.message)
  process.exit(1)
}
