/**
 * 把当前环境变量里的账号凭证保存一版到本地文件（每个平台一份 JSON）。
 *
 *   npm run save:creds
 *
 * 保存后，同一目录下运行 `node checkin.js` 会自动加载（环境变量优先）。
 * 文件以 0600 权限原子写入，且均已被 .gitignore 屏蔽；日志不打印任何 token。
 */
'use strict'

const path = require('path')
const { atomicWriteJSON } = require('../lib/state')

const DIR = process.cwd()
const MAP = [
  { env: 'TRAE_CREDENTIALS', file: 'trae-credentials.json' },
  { env: 'WORKBUDDY_CREDENTIALS', file: 'workbuddy-credentials.json' },
  { env: 'QODER_CREDENTIALS', file: 'qoder-credentials.json' },
]

function parseJsonEnv(name) {
  const raw = process.env[name]
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : [data]
  } catch {
    throw new Error(name + ' 不是合法 JSON，未保存')
  }
}

/** 手机号:AT:RT → { phone, token, refreshToken } */
function parseRefreshTokenEnv() {
  const raw = process.env.WORKBUDDY_REFRESH_TOKEN
  if (!raw) return []
  return String(raw).split(/[\r\n&]+/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const p = line.split(':')
    if (p.length < 3) return null
    return {
      phone: p[0].trim(),
      token: p.slice(1, -1).join(':').trim(),
      refreshToken: p[p.length - 1].trim(),
    }
  }).filter((x) => x && x.refreshToken)
}

function main() {
  console.log('💾 保存本地凭证（每个平台一份）')
  console.log('📁 目录: ' + DIR)
  console.log()

  let saved = 0
  for (const item of MAP) {
    try {
      let data = parseJsonEnv(item.env)
      if (!data && item.env === 'WORKBUDDY_CREDENTIALS') {
        const fromRt = parseRefreshTokenEnv()
        if (fromRt.length) data = fromRt
      }
      if (!data || !data.length) {
        console.log('  ⏭️ ' + item.env + ' 未设置，跳过')
        continue
      }
      atomicWriteJSON(path.join(DIR, item.file), data, { mode: 0o600 })
      console.log('  ✅ ' + item.env + ' → ' + item.file + '（' + data.length + ' 个账号）')
      saved++
    } catch (e) {
      console.log('  ❌ ' + e.message)
    }
  }

  console.log()
  if (!saved) {
    console.log('⚠️ 没有可保存的凭证。请先任选一种方式获取：')
    console.log('   npm run extract            # 三平台凭证提取（自动保存三份 JSON）')
    console.log('   npm run login:workbuddy    # WorkBuddy 短信登录（保存 wb_login_result.json）')
    console.log('   或先设置 TRAE_CREDENTIALS / WORKBUDDY_* / QODER_CREDENTIALS 环境变量')
    return 1
  }
  console.log('🔒 文件权限 0600，均已被 .gitignore 屏蔽，切勿提交')
  console.log('ℹ️  下次在本目录运行 node checkin.js 会自动加载；环境变量优先，LOCAL_CREDS=0 可关闭')
  console.log('ℹ️  WorkBuddy 短信登录结果 wb_login_result.json 由登录工具维护，脚本会直接读取')
  return 0
}

process.exit(main())
