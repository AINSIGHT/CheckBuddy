/**
 * 通用 HTTP 工具（零依赖）
 * 注意：全程保留 Node 默认的 TLS 证书校验，禁止设置 rejectUnauthorized: false。
 */
'use strict'

const https = require('https')
const http = require('http')

/**
 * 发起一次请求。HTTP 4xx/5xx 不作为异常抛出，由调用方按业务码判断。
 * @returns {Promise<{status:number, headers:object, data:any}>}
 */
function request(method, url, { headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let urlObj
    try { urlObj = new URL(url) } catch (e) { reject(new Error('无效 URL: ' + url)); return }
    const lib = urlObj.protocol === 'https:' ? https : http
    const postData = body !== null && body !== undefined ? JSON.stringify(body) : null
    const reqHeaders = { ...headers }
    if (postData && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = 'application/json'
    }
    const options = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: reqHeaders,
      timeout,
    }
    const req = lib.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('请求超时: ' + url)))
    if (postData) req.write(postData)
    req.end()
  })
}

/**
 * 带退避重试的请求。默认对网络异常与 5xx 重试 2 次（2s / 4s）。
 * shouldRetry(resp, err) 返回 false 可提前终止（例如命中特定业务错误码）。
 */
async function requestWithRetry(method, url, opts = {}, { retries = 2, delays = [2000, 4000], shouldRetry = null } = {}) {
  let lastErr = null
  let lastResp = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await request(method, url, opts)
      lastResp = resp
      if (shouldRetry && shouldRetry(resp, null) === false) return resp
      if (resp.status < 500 || attempt === retries) return resp
    } catch (e) {
      lastErr = e
      if (shouldRetry && shouldRetry(null, e) === false) throw e
      if (attempt === retries) throw e
    }
    const wait = delays[Math.min(attempt, delays.length - 1)]
    if (wait > 0) await sleep(wait)
  }
  if (lastResp) return lastResp
  throw lastErr || new Error('请求失败: ' + url)
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function truncate(str, max = 200) {
  if (typeof str !== 'string') {
    try { str = JSON.stringify(str) } catch { str = String(str) }
  }
  if (!str) return ''
  return str.length > max ? str.substring(0, max) + '...' : str
}

module.exports = { request, requestWithRetry, sleep, truncate }
