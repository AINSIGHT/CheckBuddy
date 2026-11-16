/**
 * 三合一凭证提取工具 - TRAE + WorkBuddy + Qoder
 *
 * 融合自三个项目：
 *   - trae-check        https://github.com/inlayin/trae-check
 *   - workbuddy-checkin  https://github.com/LiuKay/workbuddy-checkin
 *   - qoderwork-account-switcher  https://github.com/963072676/qoderwork-account-switcher
 *
 * ==================== 使用方式 ====================
 *   node extract-all-credentials.cjs              提取全部三个平台
 *   node extract-all-credentials.cjs --trae       仅提取 TRAE
 *   node extract-all-credentials.cjs --workbuddy  仅提取 WorkBuddy
 *   node extract-all-credentials.cjs --qoder      仅提取 Qoder
 *   node extract-all-credentials.cjs --qoder-pat=pt-xxxx  用 PAT 模式提取 Qoder（推荐）
 *   QODER_PAT=pt-xxxx node extract-all-credentials.cjs --qoder  也支持环境变量
 *
 * ==================== 输出 ====================
 *   输出可直接粘贴到青龙环境变量的 JSON：
 *     TRAE_CREDENTIALS       (JSON 数组)
 *     WORKBUDDY_CREDENTIALS  (JSON 数组)
 *     QODER_CREDENTIALS       (JSON 数组)
 *
 * ==================== 平台支持 ====================
 *   TRAE:      仅 Windows（需 TRAE 桌面客户端）
 *   WorkBuddy: Windows / macOS
 *   Qoder:     Windows / macOS（明文缓存无需 DPAPI；加密 auth-v2.dat 仅 Windows）
 *
 * ==================== Qoder 多账号 ====================
 *   Qoder 支持自动扫描 ~/.qoderworkcn/account-profiles/ 下的所有账号
 *   （需配合 QoderWork Account Switcher 使用）
 *   也会读取当前活跃账号的 auth-v2.dat
 */

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

// ###################################################################
//                 第一部分：TRAE 桌面端凭证提取
// ###################################################################

const TRAE_HEADER = Buffer.from([116, 99, 5, 16, 0, 0])
const TRAE_LEFT = Buffer.from([82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251, 124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203, 84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37])
const TRAE_RIGHT = Buffer.from([31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97, 23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125])

function traeSha512(val) { return crypto.createHash('sha512').update(val).digest() }

function traeDecrypt(encoded) {
  const env = Buffer.from(encoded, 'base64')
  if (env.length <= 38 || !env.subarray(0, 6).equals(TRAE_HEADER)) throw new Error('无效的 TRAE 凭证格式')
  const rk = env.subarray(6, 38)
  const secret = Buffer.from(TRAE_LEFT.map((b, i) => b ^ TRAE_RIGHT[i]))
  const d = traeSha512(Buffer.concat([traeSha512(rk), secret]))
  const dec = crypto.createDecipheriv('aes-128-cbc', d.subarray(0, 16), d.subarray(16, 32))
  const plain = Buffer.concat([dec.update(env.subarray(38)), dec.final()])
  const digest = plain.subarray(0, 64)
  const payload = plain.subarray(64)
  if (digest.length !== 64 || !crypto.timingSafeEqual(digest, traeSha512(payload))) throw new Error('TRAE 凭证完整性校验失败')
  return JSON.parse(payload.toString('utf8'))
}

function extractTraeCredential() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const storagePath = path.join(appData, 'TRAE SOLO CN', 'User', 'globalStorage', 'storage.json')
  if (!fs.existsSync(storagePath)) throw new Error('未找到 TRAE 配置文件: ' + storagePath)
  console.log('  [TRAE] 读取: ' + storagePath)
  const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
  const enc = storage['iCubeAuthInfo://icube.cloudide']
  if (typeof enc !== 'string') throw new Error('未找到 TRAE 登录信息')
  const auth = traeDecrypt(enc)
  const deviceId = storage['telemetry.devDeviceId']
  const machineId = storage['telemetry.machineId']
  if (!deviceId || !machineId) throw new Error('无法读取 TRAE 设备 ID')

  // 优先使用 Aha 16位数字设备号（来自 storage.json 键名 iCubeAuthInfo://icube-dc:{16位数字}）
  // 参考 baokun-l/trae-work-checkin: 使用 UUID 会被风控判定为非客户端设备，返回 9074
  const dcPrefix = 'iCubeAuthInfo://icube-dc:'
  var ahaDeviceId = ''
  for (var key in storage) {
    if (key.startsWith(dcPrefix)) {
      var cand = key.substring(dcPrefix.length)
      if (/^\d{8,}$/.test(cand)) { ahaDeviceId = cand; break }
    }
  }

  // 也读取 machineid 文件作为后备
  var machineidFile = path.join(appData, 'TRAE SOLO CN', 'machineid')
  var machineidFromFile = ''
  if (fs.existsSync(machineidFile)) {
    try { machineidFromFile = fs.readFileSync(machineidFile, 'utf8').trim() } catch (e) {}
  }

  var sigEntries = Object.entries(storage).filter(([k, v]) => k.startsWith(dcPrefix) && typeof v === 'string').map(([k, v]) => ({ key: k, value: v }))
  if (!sigEntries.length) throw new Error('未找到 TRAE 签名密钥')
  const sig = traeDecrypt(sigEntries[0].value)
  if (!sig.privateKeyPEM || !sig.publicKeyPEM) throw new Error('TRAE 签名密钥无效')
  return {
    token: auth.token, refreshToken: auth.refreshToken,
    expiresAt: Date.parse(auth.expiredAt), refreshExpiresAt: Date.parse(auth.refreshExpiredAt),
    // deviceId 优先级: Aha 16位数字 > machineid 文件 > telemetry UUID
    deviceId: ahaDeviceId || machineidFromFile || deviceId, machineId,
    privateKeyPEM: sig.privateKeyPEM, publicKeyPEM: sig.publicKeyPEM,
    userId: auth.userId,
    accountName: auth.account && auth.account.username ? auth.account.username : ('TRAE用户' + auth.userId),
    host: auth.host,
    // 保存原始设备信息，刷新 token 时必须用原始机器的信息，否则报 "Token device not match"
    deviceName: os.userInfo().username || 'windows',
    osInfo: os.type(),
    osVersion: os.release(),
  }
}

// ###################################################################
//               第二部分：WorkBuddy 凭证提取
// ###################################################################

function wbAuthFile() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info')
  } else if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return path.join(la, 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info')
  } else {
    const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
    return path.join(xdg, 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info')
  }
}

function extractWorkBuddyCredential() {
  let fp = wbAuthFile()
  if (!fs.existsSync(fp)) {
    // 新版桌面端文件名改为 workbuddy-desktop-ai.info
    const alt = fp.replace('workbuddy-desktop.info', 'workbuddy-desktop-ai.info')
    if (fs.existsSync(alt)) fp = alt
  }
  if (fs.existsSync(fp + '.logged-out')) throw new Error('WorkBuddy 已退出登录，请先在客户端登录')
  if (!fs.existsSync(fp)) throw new Error('未找到 WorkBuddy 登录文件: ' + fp)
  console.log('  [WorkBuddy] 读取: ' + fp)
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
  if (!data || typeof data !== 'object' || typeof data.auth !== 'object') throw new Error('WorkBuddy 登录文件缺少 auth 字段')
  const rawAt = data.auth.accessToken != null ? data.auth.accessToken : (data.auth.access_token || '')
  const rawRt = data.auth.refreshToken != null ? data.auth.refreshToken : (data.auth.refresh_token || '')
  // 5.6.2+ 默认开启 AtRestEncryption：值是 AES-256-GCM 加密信封，密钥只驻留客户端进程内存
  if (typeof rawAt === 'object' || /envelope|\$wbEncrypted/.test(String(rawAt))) {
    throw new Error('WorkBuddy 认证文件为加密信封（密钥不落盘），请改用 node tools/workbuddy-login.cjs 短信登录获取明文 AT/RT')
  }
  let token = String(rawAt).trim()
  let tokenUid = ''
  if (token.includes('+')) { const parts = token.split('+', 2); tokenUid = parts[0].trim(); token = parts[1].trim() }
  if (!token) throw new Error('WorkBuddy 登录文件缺少 access token')
  const account = data.account && typeof data.account === 'object' ? data.account : {}
  const refreshToken = typeof rawRt === 'string' ? rawRt.trim() : ''
  if (!refreshToken) console.log('  [WorkBuddy] ⚠️ 未找到 refreshToken，签到脚本将以只读 AT 模式运行（过期需重新提取）')
  return {
    token, refreshToken, uid: String(account.uid || account.id || tokenUid || '').trim(),
    enterprise_id: String(account.enterpriseId || account.enterprise_id || '').trim(),
    domain: String(data.auth.domain || data.domain || '').trim(),
  }
}

// ###################################################################
//               第三部分：Qoder 凭证提取（DPAPI + AES-256-GCM）
// ###################################################################

const QODER_V10_PREFIX = Buffer.from('v10')
const QODER_DPAPI_HEADER = 'DPAPI'
const QODER_GCM_NONCE_SIZE = 12
const QODER_GCM_TAG_SIZE = 16

/**
 * 使用 Windows DPAPI 解密（通过 PowerShell 调用）
 * 输入: base64 编码的 "DPAPI" + 加密数据
 * 输出: 解密后的原始字节 Buffer
 */
function dpapiDecrypt(encryptedKeyBase64) {
  // 构建 PowerShell 脚本
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$enc = [Convert]::FromBase64String(\'' + encryptedKeyBase64 + '\')',
    '$blob = New-Object byte[] ($enc.Length - 5)',
    '[Array]::Copy($enc, 5, $blob, 0, $blob.Length)',
    '$dec = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($dec)',
  ].join('\n')

  // 使用 -EncodedCommand 避免 PowerShell 引号转义问题
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const result = execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encodedScript], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim()
    return Buffer.from(result, 'base64')
  } catch (e) {
    throw new Error('DPAPI 解密失败（需在 Windows 上以当前用户身份运行）: ' + (e.message || String(e)))
  }
}

/**
 * 从 Local State 文件提取并解密 AES 主密钥
 */
function getQoderAesMasterKey(appDataDir) {
  const localStatePath = path.join(appDataDir, 'Local State')
  if (!fs.existsSync(localStatePath)) throw new Error('未找到 Local State 文件: ' + localStatePath)
  console.log('  [Qoder] 读取 Local State: ' + localStatePath)
  const content = fs.readFileSync(localStatePath, 'utf8')
  const json = JSON.parse(content)
  const encryptedKeyB64 = json && json.os_crypt && json.os_crypt.encrypted_key
  if (!encryptedKeyB64) throw new Error('Local State 中缺少 os_crypt.encrypted_key')

  // base64 解码后应以 "DPAPI" 开头
  const encryptedKeyBytes = Buffer.from(encryptedKeyB64, 'base64')
  const header = encryptedKeyBytes.subarray(0, 5).toString('ascii')
  if (header !== QODER_DPAPI_HEADER) throw new Error('encrypted_key 不以 DPAPI 开头 (得到: ' + header + ')')

  // DPAPI 解密
  console.log('  [Qoder] 正在通过 DPAPI 解密 AES 主密钥...')
  const aesKey = dpapiDecrypt(encryptedKeyB64)
  if (aesKey.length !== 32) throw new Error('AES 主钥长度错误: ' + aesKey.length + ' (期望 32)')
  console.log('  [Qoder] AES 主密钥解密成功 (' + aesKey.length + ' bytes)')
  return aesKey
}

/**
 * 使用 AES-256-GCM 解密 auth-v2.dat
 */
function decryptQoderAuthData(raw, aesKey) {
  // 检查 v10 前缀
  if (!raw.subarray(0, 3).equals(QODER_V10_PREFIX)) {
    // 可能是明文 JSON
    if (raw[0] === 0x7B) return JSON.parse(raw.toString('utf8'))
    throw new Error('auth-v2.dat 格式未知（不以 v10 开头）')
  }

  const payload = raw.subarray(3) // 去掉 "v10"
  const minLen = QODER_GCM_NONCE_SIZE + QODER_GCM_TAG_SIZE
  if (payload.length < minLen) throw new Error('auth-v2.dat 数据太短: ' + payload.length + ' bytes')

  const nonce = payload.subarray(0, QODER_GCM_NONCE_SIZE)
  const ctAndTag = payload.subarray(QODER_GCM_NONCE_SIZE)
  const tag = ctAndTag.subarray(ctAndTag.length - QODER_GCM_TAG_SIZE)
  const ciphertext = ctAndTag.subarray(0, ctAndTag.length - QODER_GCM_TAG_SIZE)

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}

/**
 * 从 QoderCN 明文缓存提取凭证（无需 DPAPI 解密）
 * 路径: QoderCN/SharedClientCache/cache/
 * 文件: machine_token.json (token), status.json (账号信息)
 */
function extractQoderCNFromCache(appDataDir) {
  var cacheDir = path.join(appDataDir, 'SharedClientCache', 'cache')
  if (!fs.existsSync(cacheDir)) return null

  var tokenFile = path.join(cacheDir, 'machine_token.json')
  var statusFile = path.join(cacheDir, 'status.json')

  if (!fs.existsSync(tokenFile)) return null

  console.log('  [Qoder] 读取明文缓存: ' + cacheDir)
  var tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
  if (!tokenData || !tokenData.token) return null

  // 读取账号状态
  var accountName = 'QoderCN用户'
  if (fs.existsSync(statusFile)) {
    try {
      var status = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
      if (status) {
        accountName = status.username || status.email || accountName
      }
    } catch (e) {}
  }

  // 扫描缓存目录中其他可能的 JSON 文件（如 refresh_token.json）
  var refreshToken = ''
  try {
    var cacheFiles = fs.readdirSync(cacheDir)
    for (var i = 0; i < cacheFiles.length; i++) {
      var fName = cacheFiles[i]
      if (fName.endsWith('.json') && fName !== 'machine_token.json' && fName !== 'status.json') {
        try {
          var extra = JSON.parse(fs.readFileSync(path.join(cacheDir, fName), 'utf8'))
          if (extra && (extra.refresh_token || extra.refreshToken)) {
            refreshToken = extra.refresh_token || extra.refreshToken
            console.log('  [Qoder] 发现 refresh_token: ' + fName)
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  // 尝试从 state.vscdb 读取用户 auth token（参考 cockpit-tools qoder_account.rs）
  // state.vscdb 路径: {appDataDir}/User/globalStorage/state.vscdb
  // 密钥: secret://aicoding.auth.userInfo
  // 值可能是明文 JSON 或 v10 加密（Electron safeStorage）
  var userToken = ''
  var userRefreshToken = refreshToken
  var userExpiresAt = ''
  var stateDbPath = path.join(appDataDir, 'User', 'globalStorage', 'state.vscdb')
  if (fs.existsSync(stateDbPath)) {
    console.log('  [Qoder] 发现 state.vscdb: ' + stateDbPath)
    try {
      var userInfoRaw = readQoderSecretFromStateDb(stateDbPath, appDataDir)
      if (userInfoRaw) {
        // userInfoRaw 是一个 JSON 对象，包含 token, refreshToken, expireTime 等
        userToken = userInfoRaw.token || ''
        if (userInfoRaw.refreshToken) userRefreshToken = userInfoRaw.refreshToken
        if (userInfoRaw.expireTime) userExpiresAt = String(userInfoRaw.expireTime)
        if (userInfoRaw.email) accountName = userInfoRaw.email
        if (userInfoRaw.id) {
          // user id 可用于生成 account id
        }
        console.log('  [Qoder] ✅ 从 state.vscdb 提取到用户 auth token')
      }
    } catch (e) {
      console.log('  [Qoder] state.vscdb 读取失败: ' + e.message)
    }
  } else {
    console.log('  [Qoder] state.vscdb 不存在（用户 auth token 不可用，将使用 machine token 作为 auth token）')
  }

  return {
    // userToken: 优先使用 state.vscdb 的用户 token；如果没有，回退到 machine token
    token: userToken || tokenData.token,
    // machineToken: 机器 token（用于 Cosy-MachineToken header）
    machineToken: tokenData.token,
    machineType: tokenData.type || '',
    tokenType: tokenData.type || '',
    refreshToken: userRefreshToken,
    expiresAt: userExpiresAt || (tokenData.updateAt ? String(tokenData.updateAt) : ''),
    accountName: accountName,
    source: 'qodercn-cache',
  }
}

/**
 * 从 state.vscdb SQLite 数据库读取 Qoder 用户认证信息
 * 尝试多种方法读取 SQLite: node:sqlite, better-sqlite3, sqlite3 命令行
 */
function readQoderSecretFromStateDb(dbPath, appDataDir) {
  var secretKey = 'secret://aicoding.auth.userInfo'
  var rawValue = null

  // 方法 1: Node.js 22+ 内置 sqlite 模块
  try {
    var sqliteMod = require('node:sqlite')
    var DatabaseSync = sqliteMod.DatabaseSync
    var db = new DatabaseSync(dbPath, { readOnly: true })
    var row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(secretKey)
    if (row && row.value) rawValue = typeof row.value === 'string' ? row.value : row.value.toString()
    db.close()
    console.log('  [Qoder] (node:sqlite) 读取 state.vscdb 成功')
  } catch (e) {
    // 方法 2: better-sqlite3
    try {
      var Database = require('better-sqlite3')
      var db2 = new Database(dbPath, { readonly: true })
      var row2 = db2.prepare('SELECT value FROM ItemTable WHERE key = ?').get(secretKey)
      if (row2 && row2.value) rawValue = typeof row2.value === 'string' ? row2.value : row2.value.toString()
      db2.close()
      console.log('  [Qoder] (better-sqlite3) 读取 state.vscdb 成功')
    } catch (e2) {
      // 方法 3: sqlite3 命令行工具
      try {
        var { execSync } = require('child_process')
        var output = execSync('sqlite3 "' + dbPath + '" "SELECT value FROM ItemTable WHERE key = \'' + secretKey + '\'"', { encoding: 'utf8', timeout: 5000 })
        if (output.trim()) rawValue = output.trim()
        console.log('  [Qoder] (sqlite3) 读取 state.vscdb 成功')
      } catch (e3) {
        console.log('  [Qoder] ⚠️ 无法读取 state.vscdb（需要 Node.js 22+ 或 sqlite3）')
      }
    }
  }

  if (!rawValue) return null

  // 检查值是否加密（v10 前缀 = Electron safeStorage）
  if (rawValue.startsWith('v10')) {
    // 需要解密: AES-256-GCM + DPAPI
    try {
      var aesKey = getQoderAesMasterKey(appDataDir)
      var decrypted = decryptV10(rawValue, aesKey)
      return JSON.parse(decrypted)
    } catch (e) {
      console.log('  [Qoder] state.vscdb 值解密失败: ' + e.message)
      return null
    }
  }

  // 明文 JSON
  try {
    return JSON.parse(rawValue)
  } catch (e) {
    return null
  }
}

/**
 * 从 auth-v2.dat 解密提取凭证
 */
function extractQoderFromAuthFile(authFilePath, aesKey) {
  if (!fs.existsSync(authFilePath)) return null
  const raw = fs.readFileSync(authFilePath)
  const authData = decryptQoderAuthData(raw, aesKey)
  if (!authData || typeof authData.token !== 'string') throw new Error('Qoder auth-v2.dat 中缺少 token')

  const user = authData.user && typeof authData.user === 'object' ? authData.user : {}
  return {
    token: authData.token,
    refreshToken: authData.refresh_token || authData.refreshToken || '',
    expiresAt: authData.expires_at || authData.expiresAt || '',
    email: user.email || '',
    userId: String(user.id || ''),
    accountName: user.email || user.name || ('Qoder用户' + (user.id || '未知')),
  }
}

/**
 * 查找所有可能的 Qoder 应用数据目录
 * 返回包含 auth-v2.dat 的目录列表
 */
function findQoderAppDirs() {
  var appDataBase
  if (process.platform === 'win32') {
    appDataBase = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  } else if (process.platform === 'darwin') {
    appDataBase = path.join(os.homedir(), 'Library', 'Application Support')
  } else {
    appDataBase = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  }

  var candidates = ['QoderCN', 'Qoder CN', 'QoderWork', 'QoderWork CN', 'Qoder', 'qoder']
  var found = []
  for (var i = 0; i < candidates.length; i++) {
    var dir = path.join(appDataBase, candidates[i])
    if (fs.existsSync(dir)) found.push(dir)
  }
  return found
}

/**
 * 提取 Qoder 凭证（支持多账号、多目录、明文缓存 + 加密文件）
 * 1. 优先读取 QoderCN 明文缓存 (SharedClientCache/cache/machine_token.json)
 * 2. 回退到 QoderWork auth-v2.dat (AES-256-GCM + DPAPI 解密)
 * 3. 扫描 Account Switcher 的账号配置文件目录
 */
function extractQoderCredentials() {
  var appDirs = findQoderAppDirs()
  if (appDirs.length === 0) {
    throw new Error('未找到任何 Qoder 目录，请确认已安装并登录 QoderCN')
  }

  console.log('  [Qoder] 找到 ' + appDirs.length + ' 个 Qoder 目录:')
  for (var i = 0; i < appDirs.length; i++) {
    console.log('    ' + (i + 1) + '. ' + appDirs[i])
  }

  var accounts = []
  var seenTokens = new Set()

  // 阶段 1: 优先读取 QoderCN 明文缓存（无需 DPAPI，跨平台）
  for (var ci = 0; ci < appDirs.length; ci++) {
    var cacheDir = appDirs[ci]
    console.log('\n  [Qoder] 检查明文缓存: ' + cacheDir)
    try {
      var cred = extractQoderCNFromCache(cacheDir)
      if (cred && !seenTokens.has(cred.token)) {
        seenTokens.add(cred.token)
        accounts.push(cred)
        console.log('  [Qoder] ✅ 账号: ' + cred.accountName + ' (明文缓存, 来源: ' + path.basename(cacheDir) + ')')
      }
    } catch (e) {
      console.log('  [Qoder] 明文缓存读取失败: ' + e.message)
    }
  }

  // 阶段 2: 如果明文缓存没找到，尝试 auth-v2.dat 解密（仅 Windows DPAPI）
  if (accounts.length === 0 && process.platform === 'win32') {
    console.log('\n  [Qoder] 明文缓存未找到凭证，尝试 auth-v2.dat 解密...')
    for (var di = 0; di < appDirs.length; di++) {
      var appDataDir = appDirs[di]
      console.log('\n  [Qoder] 处理目录: ' + appDataDir)

      var aesKey = null
      try {
        aesKey = getQoderAesMasterKey(appDataDir)
      } catch (e) {
        console.log('  [Qoder] ⚠️ 无法获取 AES 密钥: ' + e.message)
        continue
      }

      var activeAuthPath = path.join(appDataDir, 'auth-v2.dat')
      if (fs.existsSync(activeAuthPath)) {
        console.log('  [Qoder] 读取 auth-v2.dat: ' + activeAuthPath)
        try {
          var cred2 = extractQoderFromAuthFile(activeAuthPath, aesKey)
          if (cred2 && !seenTokens.has(cred2.token)) {
            seenTokens.add(cred2.token)
            accounts.push(cred2)
            console.log('  [Qoder] ✅ 账号: ' + cred2.accountName + ' (加密文件, 来源: ' + path.basename(appDataDir) + ')')
          }
        } catch (e) {
          console.log('  [Qoder] ⚠️ 解密失败: ' + e.message)
        }
      } else {
        console.log('  [Qoder] 该目录下无 auth-v2.dat')
      }
    }

    // 阶段 3: 扫描 Account Switcher 账号配置
    var profilesDirs = [
      path.join(os.homedir(), '.qoderworkcn', 'account-profiles'),
      path.join(os.homedir(), '.qodercn', 'account-profiles'),
      path.join(os.homedir(), '.qoder', 'account-profiles'),
    ]
    for (var pdi = 0; pdi < profilesDirs.length; pdi++) {
      var profilesDir = profilesDirs[pdi]
      if (!fs.existsSync(profilesDir)) continue
      console.log('\n  [Qoder] 扫描 Account Switcher 账号目录: ' + profilesDir)

      var keys = []
      for (var di2 = 0; di2 < appDirs.length; di2++) {
        try { keys.push(getQoderAesMasterKey(appDirs[di2])) } catch (e) {}
      }

      var entries = fs.readdirSync(profilesDir, { withFileTypes: true })
      for (var ei = 0; ei < entries.length; ei++) {
        if (!entries[ei].isDirectory()) continue
        var profileAuthPath = path.join(profilesDir, entries[ei].name, 'auth-v2.dat')
        if (!fs.existsSync(profileAuthPath)) continue
        console.log('  [Qoder] 读取账号配置: ' + entries[ei].name)
        for (var ki = 0; ki < keys.length; ki++) {
          try {
            var cred3 = extractQoderFromAuthFile(profileAuthPath, keys[ki])
            if (cred3 && !seenTokens.has(cred3.token)) {
              seenTokens.add(cred3.token)
              accounts.push(cred3)
              console.log('  [Qoder] ✅ 账号: ' + cred3.accountName)
            }
            break
          } catch (e) {
            if (ki === keys.length - 1) {
              console.log('  [Qoder] ⚠️ 账号 ' + entries[ei].name + ' 解密失败: ' + e.message)
            }
          }
        }
      }
    }
  }

  if (accounts.length === 0) {
    throw new Error('未能提取任何 Qoder 凭证，请确认已在 QoderCN 中登录')
  }

  console.log('\n  [Qoder] 共提取 ' + accounts.length + ' 个账号')
  return accounts
}

// ###################################################################
//                        第四部分：主流程
// ################################################################===

function printSection(title) {
  console.log()
  console.log('━'.repeat(60))
  console.log(title)
  console.log('━'.repeat(60))
}

function printCredential(envVar, json) {
  console.log()
  console.log('📋 复制以下 JSON 到青龙环境变量 ' + envVar + ':')
  console.log('─'.repeat(60))
  console.log(JSON.stringify(json))
  console.log('─'.repeat(60))
}

function saveJson(filename, data) {
  const outputPath = path.join(process.cwd(), filename)
  fs.writeFileSync(outputPath, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8')
  return outputPath
}

function main() {
  const args = process.argv.slice(2)
  const onlyTrae = args.includes('--trae')
  const onlyWorkBuddy = args.includes('--workbuddy')
  const onlyQoder = args.includes('--qoder')
  // 支持 --qoder-pat=pt-xxxx 或环境变量 QODER_PAT
  const patArg = args.find(function (a) { return a.startsWith('--qoder-pat=') })
  const qoderPat = (patArg ? patArg.substring('--qoder-pat='.length) : '') || process.env.QODER_PAT || process.env.QODERCN_PAT || ''
  const doAll = !onlyTrae && !onlyWorkBuddy && !onlyQoder

  console.log('🔍 三合一凭证提取工具 - TRAE + WorkBuddy + Qoder')
  console.log('💻 平台: ' + process.platform)
  console.log('⏰ 时间: ' + new Date().toLocaleString('zh-CN'))

  let traeCreds = null
  let wbCreds = null
  let qoderCreds = null

  // TRAE
  if (doAll || onlyTrae) {
    printSection('🚀 提取 TRAE 凭证')
    try {
      const cred = extractTraeCredential()
      traeCreds = [cred]
      console.log('  ✅ 提取成功')
      console.log('     账号: ' + cred.accountName)
      console.log('     Host: ' + cred.host)
      console.log('     Token 过期: ' + new Date(cred.expiresAt).toLocaleString('zh-CN'))
    } catch (e) {
      console.log('  ❌ ' + e.message)
      if (onlyTrae) process.exit(1)
    }
  }

  // WorkBuddy
  if (doAll || onlyWorkBuddy) {
    printSection('🚀 提取 WorkBuddy 凭证')
    try {
      const cred = extractWorkBuddyCredential()
      wbCreds = [cred]
      console.log('  ✅ 提取成功')
      console.log('     用户ID: ' + (cred.uid || '(未获取)'))
      console.log('     域: ' + (cred.domain || '(默认)'))
    } catch (e) {
      console.log('  ❌ ' + e.message)
      if (onlyWorkBuddy) process.exit(1)
    }
  }

  // Qoder
  if (doAll || onlyQoder) {
    printSection('🚀 提取 Qoder 凭证')
    if (qoderPat) {
      // PAT 模式：用户提供 PAT，签到时自动交换为 job token
      console.log('  [Qoder] 使用 PAT 模式（推荐）')
      console.log('  [Qoder] PAT: ' + qoderPat.substring(0, 10) + '...')
      try {
        // 尝试从缓存获取账号信息
        var qoderAccounts = []
        try { qoderAccounts = extractQoderCredentials() } catch (e) {}
        // 将 PAT 添加到凭证中
        if (qoderAccounts.length > 0) {
          qoderCreds = qoderAccounts.map(function (c) {
            c.pat = qoderPat
            return c
          })
        } else {
          // 如果缓存提取失败，只用 PAT 创建凭证
          qoderCreds = [{ pat: qoderPat, token: '', accountName: 'QoderCN用户(PAT)', source: 'pat' }]
        }
        console.log('  ✅ PAT 凭证已创建（签到时自动交换为 job token）')
      } catch (e) {
        console.log('  ❌ ' + e.message)
        if (onlyQoder) process.exit(1)
      }
    } else {
      console.log('  ℹ️ 未提供 PAT，尝试从本地缓存提取...')
      console.log('  ℹ️ 提示: PAT 模式更可靠，用法: node extract-all-credentials.cjs --qoder-pat=pt-xxxx')
      console.log('  ℹ️ 获取 PAT: 登录 https://qoder.com.cn → 设置 → API Keys → 新建')
      try {
        qoderCreds = extractQoderCredentials()
      } catch (e) {
        console.log('  ❌ ' + e.message)
        if (onlyQoder) process.exit(1)
      }
    }
  }

  // 输出结果
  if (traeCreds) {
    printCredential('TRAE_CREDENTIALS', traeCreds)
    saveJson('trae-credentials.json', traeCreds)
    console.log('💾 已保存到: trae-credentials.json')
  }

  if (wbCreds) {
    printCredential('WORKBUDDY_CREDENTIALS', wbCreds)
    saveJson('workbuddy-credentials.json', wbCreds)
    console.log('💾 已保存到: workbuddy-credentials.json')
  }

  if (qoderCreds) {
    printCredential('QODER_CREDENTIALS', qoderCreds)
    saveJson('qoder-credentials.json', qoderCreds)
    console.log('💾 已保存到: qoder-credentials.json')
  }

  // 注意事项
  if (traeCreds || wbCreds || qoderCreds) {
    console.log()
    console.log('━'.repeat(60))
    console.log('⚠️  注意事项:')
    console.log('━'.repeat(60))
    if (traeCreds) {
      console.log('  [TRAE]')
      console.log('    1. 凭证含私钥和 token，请妥善保管')
      console.log('    2. Token 有效期较短，签到脚本会自动刷新')
      console.log('    3. 多账号: 在 TRAE 桌面端切换账号后重跑，将多个凭证合并为数组')
    }
    if (wbCreds) {
      console.log('  [WorkBuddy]')
      console.log('    1. 若输出含 refreshToken，签到脚本会自动续期并轮换 RT（Token 永续）')
      console.log('    2. 若客户端为 5.6.2+ 加密信封，请改用 node tools/workbuddy-login.cjs 短信登录')
      console.log('    3. 多账号: 切换 WorkBuddy 账号后重跑，将多个凭证合并为数组')
    }
    if (qoderCreds) {
      console.log('  [Qoder]')
      console.log('    1. 本脚本会自动扫描 Account Switcher 保存的所有账号')
      console.log('    2. Token 有效期约 1 小时，签到脚本会自动刷新')
      console.log('    3. 如需添加新账号: 在 QoderWork 登录后重跑本脚本')
      console.log('    4. DPAPI 解密需以登录用户的身份运行（不能以管理员或其他用户运行）')
    }
  }

  if (!traeCreds && !wbCreds && !qoderCreds) {
    console.log('\n❌ 未能提取任何凭证')
    process.exit(1)
  }
}

main()
