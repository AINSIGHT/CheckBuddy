/**
 * 本地状态文件：原子读写 + 跨进程文件锁。
 * RT 每次续期都会轮换，写回失败或并发覆盖会导致账号永久掉线，故全部写操作走这里。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function atomicReadJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function atomicWriteJSON(file, data, { mode = 0o600 } = {}) {
  ensureDir(path.dirname(file))
  const tmp = file + '.tmp.' + process.pid + '.' + crypto.randomBytes(4).toString('hex')
  const fd = fs.openSync(tmp, 'w', mode)
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file) // 同分区内为原子操作
  try { fs.chmodSync(file, mode) } catch { /* Windows 上可能不支持，忽略 */ }
}

/**
 * 简易跨进程锁：O_EXCL 创建 lockfile，超时后清理陈旧锁。
 * 用法：await withLock(file, async () => { ... })
 */
async function withLock(name, fn, { timeoutMs = 10000, staleMs = 120000 } = {}) {
  const lock = name + '.lock'
  ensureDir(path.dirname(lock))
  const started = Date.now()
  let fd = null
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx')
      fs.writeFileSync(fd, String(process.pid))
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        const st = fs.statSync(lock)
        if (Date.now() - st.mtimeMs > staleMs) { fs.unlinkSync(lock); continue }
      } catch { /* 锁刚好被释放，重试 */ }
      if (Date.now() - started > timeoutMs) throw new Error('获取文件锁超时: ' + path.basename(name))
      await new Promise((r) => setTimeout(r, 60))
    }
  }
  try { fs.closeSync(fd) } catch { /* ignore */ }
  try {
    return await fn()
  } finally {
    try { fs.unlinkSync(lock) } catch { /* ignore */ }
  }
}

function uidHash(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16)
}

function statePath(stateDir, name) { return path.join(stateDir, name) }

module.exports = { atomicReadJSON, atomicWriteJSON, withLock, uidHash, statePath, ensureDir }
