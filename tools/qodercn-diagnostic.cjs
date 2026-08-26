#!/usr/bin/env node
/**
 * QoderCN 诊断脚本
 * 检查 QoderCN 目录下的所有关键文件
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

function findQoderDirs() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const candidates = ['QoderCN', 'Qoder CN', 'QoderWork', 'QoderWork CN', 'Qoder', 'qoder']
  const dirs = []
  for (const name of candidates) {
    const dir = path.join(appData, name)
    if (fs.existsSync(dir)) dirs.push({ dir, source: 'APPDATA' })
    const ldir = path.join(localAppData, name)
    if (fs.existsSync(ldir)) dirs.push({ dir: ldir, source: 'LOCALAPPDATA' })
  }
  return dirs
}

function listFilesRecursive(dir, maxDepth, currentDepth, results) {
  if (currentDepth > maxDepth) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push({ path: fullPath, type: 'dir', depth: currentDepth })
        listFilesRecursive(fullPath, maxDepth, currentDepth + 1, results)
      } else {
        const stat = fs.statSync(fullPath)
        results.push({ path: fullPath, type: 'file', size: stat.size, depth: currentDepth })
      }
    }
  } catch (e) {}
}

function checkSQLite(dbPath) {
  console.log('\n  检查 state.vscdb: ' + dbPath)
  if (!fs.existsSync(dbPath)) {
    console.log('  ❌ state.vscdb 不存在')
    return
  }
  const stat = fs.statSync(dbPath)
  console.log('  ✅ state.vscdb 存在, 大小: ' + (stat.size / 1024).toFixed(1) + ' KB')

  // 尝试读取 SQLite 数据库
  // 方法 1: Node.js 22+ 内置 sqlite 模块
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare('SELECT key, length(value) as vlen FROM ItemTable WHERE key LIKE ?').all('secret://aicoding%')
    if (rows.length > 0) {
      console.log('  ✅ 找到 Qoder 密钥:')
      for (const row of rows) {
        console.log('    ' + row.key + ' (value 长度: ' + row.vlen + ')')
      }
      // 读取 userInfo 的值
      const userInfoRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('secret://aicoding.auth.userInfo')
      if (userInfoRow) {
        const val = userInfoRow.value
        const valStr = typeof val === 'string' ? val : val.toString()
        // 检查是否加密（v10 前缀）
        if (valStr.startsWith('v10')) {
          console.log('  📌 userInfo 值: v10 加密 (Electron safeStorage), 长度: ' + valStr.length)
        } else {
          console.log('  📌 userInfo 值: 明文, 前100字符: ' + valStr.substring(0, 100))
        }
      }
    } else {
      console.log('  ⚠️ ItemTable 中未找到 secret://aicoding.* 密钥')
      // 列出所有以 secret:// 开头的键
      const allSecrets = db.prepare("SELECT key FROM ItemTable WHERE key LIKE 'secret://%'").all()
      if (allSecrets.length > 0) {
        console.log('  其他 secret:// 键:')
        for (const s of allSecrets.slice(0, 20)) {
          console.log('    ' + s.key)
        }
      }
    }
    db.close()
    return
  } catch (e) {
    console.log('  ⚠️ node:sqlite 不可用: ' + (e.code || e.message))
  }

  // 方法 2: better-sqlite3
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare("SELECT key FROM ItemTable WHERE key LIKE 'secret://aicoding%'").all()
    if (rows.length > 0) {
      console.log('  ✅ (better-sqlite3) 找到 Qoder 密钥:')
      for (const row of rows) console.log('    ' + row.key)
    } else {
      console.log('  ⚠️ (better-sqlite3) 未找到 secret://aicoding.* 密钥')
    }
    db.close()
    return
  } catch (e) {
    console.log('  ⚠️ better-sqlite3 不可用')
  }

  // 方法 3: sqlite3 命令行工具
  try {
    const { execSync } = require('child_process')
    const output = execSync('sqlite3 "' + dbPath + '" "SELECT key, length(value) FROM ItemTable WHERE key LIKE \'secret://aicoding%\'"', { encoding: 'utf8', timeout: 5000 })
    if (output.trim()) {
      console.log('  ✅ (sqlite3) 找到 Qoder 密钥:')
      console.log('    ' + output.trim().split('\n').join('\n    '))
    } else {
      console.log('  ⚠️ (sqlite3) 未找到 secret://aicoding.* 密钥')
    }
    return
  } catch (e) {
    console.log('  ⚠️ sqlite3 命令行工具不可用')
  }

  console.log('  ℹ️ 无法读取 SQLite 数据库，请安装 sqlite3 或使用 Node.js 22+')
}

function main() {
  console.log('QoderCN 诊断工具')
  console.log('='.repeat(60))

  const dirs = findQoderDirs()
  if (dirs.length === 0) {
    console.log('\n❌ 未找到任何 Qoder 相关目录')
    console.log('请确认已安装并登录 QoderCN')
    return
  }

  console.log('\n找到 ' + dirs.length + ' 个 Qoder 目录:')
  for (const { dir, source } of dirs) {
    console.log('  [' + source + '] ' + dir)
  }

  for (const { dir, source } of dirs) {
    console.log('\n' + '='.repeat(60))
    console.log('扫描目录: ' + dir + ' (' + source + ')')
    console.log('='.repeat(60))

    // 列出目录下所有文件（深度 4）
    const files = []
    listFilesRecursive(dir, 4, 0, files)

    // 检查关键文件
    const stateDb = path.join(dir, 'User', 'globalStorage', 'state.vscdb')
    const localState = path.join(dir, 'Local State')
    const machineToken = path.join(dir, 'SharedClientCache', 'cache', 'machine_token.json')
    const statusFile = path.join(dir, 'SharedClientCache', 'cache', 'status.json')
    const authV2 = path.join(dir, 'auth-v2.dat')

    console.log('\n关键文件检查:')
    const keyFiles = [
      ['state.vscdb (SQLite)', stateDb],
      ['Local State (AES密钥)', localState],
      ['machine_token.json', machineToken],
      ['status.json', statusFile],
      ['auth-v2.dat (旧格式)', authV2],
    ]
    for (const [name, filePath] of keyFiles) {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath)
        console.log('  ✅ ' + name + ': ' + filePath + ' (' + (stat.size / 1024).toFixed(1) + ' KB)')
      } else {
        console.log('  ❌ ' + name + ': 不存在')
      }
    }

    // 检查 Local State 是否有 os_crypt.encrypted_key
    if (fs.existsSync(localState)) {
      try {
        const lsData = JSON.parse(fs.readFileSync(localState, 'utf8'))
        if (lsData && lsData.os_crypt && lsData.os_crypt.encrypted_key) {
          console.log('  ✅ Local State 包含 os_crypt.encrypted_key')
        } else {
          console.log('  ⚠️ Local State 不包含 os_crypt.encrypted_key')
          console.log('  Local State 内容: ' + JSON.stringify(lsData).substring(0, 200))
        }
      } catch (e) {
        console.log('  ⚠️ Local State 解析失败: ' + e.message)
      }
    }

    // 检查 state.vscdb
    if (fs.existsSync(stateDb)) {
      checkSQLite(stateDb)
    }

    // 检查 machine_token.json
    if (fs.existsSync(machineToken)) {
      try {
        const mt = JSON.parse(fs.readFileSync(machineToken, 'utf8'))
        console.log('\n  machine_token.json 内容:')
        console.log('    token: ' + (mt.token ? mt.token.substring(0, 30) + '...' : '无'))
        console.log('    type: ' + (mt.type || '无'))
        console.log('    updateAt: ' + (mt.updateAt || '无'))
      } catch (e) {}
    }

    // 列出所有文件（过滤关键文件后）
    const knownFiles = new Set([stateDb, localState, machineToken, statusFile, authV2])
    const otherFiles = files.filter(f => f.type === 'file' && !knownFiles.has(f.path))
    if (otherFiles.length > 0) {
      console.log('\n其他文件 (非关键文件):')
      for (const f of otherFiles.slice(0, 30)) {
        console.log('  ' + f.path + ' (' + (f.size / 1024).toFixed(1) + ' KB)')
      }
      if (otherFiles.length > 30) {
        console.log('  ... 还有 ' + (otherFiles.length - 30) + ' 个文件')
      }
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('诊断完成')
  console.log('请将以上完整输出反馈')
}

main()
