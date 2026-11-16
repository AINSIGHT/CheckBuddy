/** 通知：青龙 sendNotify + 7 渠道 webhook，配哪个推哪个，互不影响 */
'use strict'

const crypto = require('crypto')
const { request } = require('./http')
const { envStr } = require('./env')

const truncate = (s, n = 300) => (String(s || '').length > n ? String(s).slice(0, n) + '...' : String(s || ''))

/** 青龙面板内置通知（保持旧行为） */
async function sendQinglong(title, content) {
  console.log('\n' + '='.repeat(60))
  console.log('📢 ' + title)
  console.log('='.repeat(60))
  console.log(content)
  console.log('='.repeat(60) + '\n')
  const paths = ['./sendNotify', './notify', '../sendNotify', '/ql/scripts/sendNotify', '/ql/data/scripts/sendNotify']
  for (const p of paths) {
    try {
      const notify = require(p)
      if (typeof notify.sendNotify === 'function') { await notify.sendNotify(title, content); return true }
      if (typeof notify === 'function') { await notify(title, content); return true }
    } catch { /* 未找到该通知模块 */ }
  }
  return false
}

async function post(url, body, headers = {}) {
  const resp = await request('POST', url, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body, timeout: 15000,
  })
  if (resp.status >= 400) throw new Error('HTTP ' + resp.status)
  return resp.data
}

const CHANNELS = [
  {
    name: 'Bark', enabled: () => !!envStr('BARK_URL'),
    send: async (title, content) => {
      const base = envStr('BARK_URL').replace(/\/+$/, '')
      await post(base, { title, body: truncate(content, 2000), group: '签到' })
    },
  },
  {
    name: 'PushPlus', enabled: () => !!envStr('PUSHPLUS_TOKEN'),
    send: (title, content) => post('https://www.pushplus.plus/send', {
      token: envStr('PUSHPLUS_TOKEN'), title, content: truncate(content, 8000), template: 'txt',
    }),
  },
  {
    name: 'WxPusher', enabled: () => !!envStr('WXPUSHER_APP_TOKEN'),
    send: (title, content) => post('https://wxpusher.zjiecode.com/api/send/message', {
      appToken: envStr('WXPUSHER_APP_TOKEN'),
      uids: envStr('WXPUSHER_UID').split(/[,;\s]+/).filter(Boolean),
      summary: title, content: truncate(content, 8000), contentType: 1,
    }),
  },
  {
    name: 'Server酱', enabled: () => !!envStr('SERVERCHAN_SENDKEY'),
    send: async (title, content) => {
      const key = envStr('SERVERCHAN_SENDKEY')
      // Server酱³ 的 sendkey 形如 sctp1234txxxx，需取其中的数字作为专属域名
      const m = key.match(/^sctp(\d+)t/i)
      const url = m
        ? 'https://' + m[1] + '.push.ft07.com/send/' + key + '.send'
        : 'https://sctapi.ftqq.com/' + key + '.send'
      await post(url, { title, desp: truncate(content, 8000) })
    },
  },
  {
    name: '企业微信', enabled: () => !!envStr('WECOM_WEBHOOK'),
    send: (title, content) => {
      const raw = envStr('WECOM_WEBHOOK')
      const url = raw.startsWith('http') ? raw : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + raw
      return post(url, { msgtype: 'text', text: { content: title + '\n\n' + truncate(content, 4000) } })
    },
  },
  {
    name: '钉钉', enabled: () => !!envStr('DINGTALK_WEBHOOK'),
    send: (title, content) => {
      let url = envStr('DINGTALK_WEBHOOK')
      if (!url.startsWith('http')) url = 'https://oapi.dingtalk.com/robot/send?access_token=' + url
      const secret = envStr('DINGTALK_SECRET')
      if (secret) {
        const ts = Date.now()
        const sign = crypto.createHmac('sha256', secret).update(ts + '\n' + secret).digest('base64')
        url += '&timestamp=' + ts + '&sign=' + encodeURIComponent(sign)
      }
      return post(url, { msgtype: 'text', text: { content: title + '\n\n' + truncate(content, 4000) } })
    },
  },
  {
    name: '青龙OpenAPI', enabled: () => !!envStr('QL_CLIENT_ID') && !!envStr('QL_CLIENT_SECRET'),
    send: async (title, content) => {
      const base = envStr('QL_URL', 'http://127.0.0.1:5700').replace(/\/+$/, '')
      const tokenResp = await request('GET', base + '/open/auth/token?client_id=' + encodeURIComponent(envStr('QL_CLIENT_ID')) + '&client_secret=' + encodeURIComponent(envStr('QL_CLIENT_SECRET')), { timeout: 15000 })
      const token = tokenResp.data && tokenResp.data.data && tokenResp.data.data.token
      if (!token) throw new Error('换取青龙令牌失败')
      const resp = await request('PUT', base + '/open/system/notify', {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: { title, content: truncate(content, 4000) }, timeout: 15000,
      })
      if (resp.status >= 400) throw new Error('HTTP ' + resp.status)
    },
  },
]

/**
 * @param strategy always | fail | 0（CLI --notify 优先于环境变量 NOTIFY）
 */
async function notifyAll(title, content, ctx, { hasFailure = false } = {}) {
  await sendQinglong(title, content)
  const strategy = (ctx.args && ctx.args.notify) || envStr('NOTIFY', 'always').toLowerCase()
  if (strategy === '0' || strategy === 'off' || strategy === 'false') return
  if (strategy === 'fail' && !hasFailure) return
  for (const ch of CHANNELS) {
    if (!ch.enabled()) continue
    try {
      await ch.send(title, content)
      console.log('  📬 ' + ch.name + ' 推送成功')
    } catch (e) {
      console.log('  ⚠️ ' + ch.name + ' 推送失败: ' + truncate(e.message, 120))
    }
  }
}

module.exports = { sendQinglong, notifyAll }
