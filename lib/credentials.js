/**
 * 本地凭证文件回退加载（方便本机测试与多账号管理）。
 *
 * 规则：
 *   1. 环境变量始终优先；只有对应变量为空时才读取固定文件名的本地凭证
 *   2. 只读取工作目录下这几个固定文件名，不递归、不接受任意路径
 *   3. WorkBuddy 短信登录结果 wb_login_result.json 优先于 workbuddy-credentials.json；
 *      读取时按手机号去重，避免历史重复行造成同一账号被加载两次
 *   4. LOCAL_CREDS=0 可完全关闭；所有文件均已被 .gitignore 屏蔽
 *   5. 日志只打印文件名与账号数，绝不输出 token 内容
 */
'use strict'

const fs = require('fs')
const path = require('path')

const LOGIN_FILE = 'wb_login_result.json'
const PLATFORM_FILES = [
  { env: 'TRAE_CREDENTIALS', file: 'trae-credentials.json' },
  { env: 'QODER_CREDENTIALS', file: 'qoder-credentials.json' },
  { env: 'WORKBUDDY_CREDENTIALS', file: 'workbuddy-credentials.json' },
]

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function loadLocalCredentials({ dir = process.cwd(), enabled = true } = {}) {
  const result = { loaded: [], skipped: [] }
  if (!enabled) {
    result.skipped.push('LOCAL_CREDS=0，已禁用本地凭证加载')
    return result
  }

  // ① WorkBuddy 短信登录结果：把 env_line 拼成 WORKBUDDY_REFRESH_TOKEN 的多行格式
  if (!process.env.WORKBUDDY_REFRESH_TOKEN) {
    const login = readJson(path.join(dir, LOGIN_FILE))
    const rows = Array.isArray(login) ? login : (login && typeof login === 'object' ? [login] : [])
    // 兼容没有 env_line 的旧条目，并按手机号去重（防止历史重复行导致同一账号签到两次）
    const seen = new Set()
    const lines = rows.map((r) => {
      if (!r) return ''
      const line = String(r.env_line || '').trim()
      if (line) return line
      if (r.phone && r.refresh_token) return r.phone + ':' + (r.access_token || '') + ':' + r.refresh_token
      return ''
    }).filter((line) => {
      if (!line || line.split(':').length < 3) return false
      const phone = line.split(':')[0]
      if (seen.has(phone)) return false
      seen.add(phone)
      return true
    })
    if (lines.length) {
      process.env.WORKBUDDY_REFRESH_TOKEN = lines.join('\n')
      result.loaded.push({ env: 'WORKBUDDY_REFRESH_TOKEN', file: LOGIN_FILE, count: lines.length })
    }
  }
  const hasWbRt = !!process.env.WORKBUDDY_REFRESH_TOKEN

  // ② 三平台凭证 JSON（数组或单账号对象均可）
  for (const item of PLATFORM_FILES) {
    if (process.env[item.env]) continue
    if (item.env === 'WORKBUDDY_CREDENTIALS' && hasWbRt) {
      result.skipped.push('已有 WORKBUDDY_REFRESH_TOKEN，跳过 ' + item.file + '（避免账号重复）')
      continue
    }
    const data = readJson(path.join(dir, item.file))
    if (!data) continue
    const count = Array.isArray(data) ? data.length : 1
    if (!count) continue
    process.env[item.env] = JSON.stringify(data)
    result.loaded.push({ env: item.env, file: item.file, count })
  }
  return result
}

module.exports = { loadLocalCredentials, PLATFORM_FILES, LOGIN_FILE }
