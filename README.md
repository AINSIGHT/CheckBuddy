# AI 编码工具签到脚本合集

> **TRAE + WorkBuddy + Qoder 三合一自动签到**，支持青龙面板订阅、QD（qiandao）框架，全部支持多账号。

融合自多个开源项目：

| 平台 | 参考项目 | 签到奖励 |
|---|---|---|
| TRAE | [trae-check](https://github.com/inlayin/trae-check) · [baokun-l/trae-work-checkin](https://github.com/baokun-l/trae-work-checkin) · [iicookies/auto-checkin](https://github.com/iicookies/auto-checkin) | 每日积分 |
| WorkBuddy | [workbuddy-checkin](https://github.com/LiuKay/workbuddy-checkin) | 每日积分 + 连续签到天数 |
| Qoder | [pi-provider-qoder](https://github.com/simonsmh/pi-provider-qoder) · [qoderwork-account-switcher](https://github.com/963072676/qoderwork-account-switcher) | 每日 100 Credits |

---

## 仓库结构

```
.
├── checkin_all.js                # 青龙面板签到主脚本（三平台合一）
├── config.sh                      # 环境变量配置模板
├── tools/
│   ├── extract-all-credentials.cjs  # 凭证提取工具（三平台合一）
│   └── qodercn-diagnostic.cjs        # QoderCN 诊断工具
├── qd-templates/
│   ├── trae_checkin.har            # QD 模板 - TRAE
│   ├── workbuddy_checkin.har       # QD 模板 - WorkBuddy
│   └── qoder_checkin.har           # QD 模板 - Qoder
└── README.md                      # 本文件
```

---

## 快速开始

### 方案一：青龙面板（推荐）

#### 第一步 — 订阅仓库

在青龙面板「订阅管理」中添加本仓库，或在「定时任务」中手动配置：

| 配置项 | 值 |
|---|---|
| 命令 | `task checkin_all.js` |
| Cron | `30 8 * * *`（每天 8:30） |

#### 第二步 — 提取凭证

在已登录 TRAE / WorkBuddy / Qoder 桌面客户端的电脑上安装 Node.js（v18+），然后运行：

```bash
# 提取全部三个平台的凭证
node tools/extract-all-credentials.cjs

# 或单独提取某个平台
node tools/extract-all-credentials.cjs --trae
node tools/extract-all-credentials.cjs --workbuddy
node tools/extract-all-credentials.cjs --qoder

# Qoder 推荐使用 PAT 模式（见下文）
node tools/extract-all-credentials.cjs --qoder-pat=pt-xxxx
```

脚本会输出可直接复制的 JSON，同时保存到以下文件：

| 输出文件 | 对应环境变量 |
|---|---|
| `trae-credentials.json` | `TRAE_CREDENTIALS` |
| `workbuddy-credentials.json` | `WORKBUDDY_CREDENTIALS` |
| `qoder-credentials.json` | `QODER_CREDENTIALS` |

#### 第三步 — 配置环境变量

在青龙面板「环境变量」中添加（三个都可选，配了哪个签哪个）：

| 环境变量 | 值格式 | 说明 |
|---|---|---|
| `TRAE_CREDENTIALS` | JSON 数组 | TRAE 桌面端凭证 |
| `WORKBUDDY_CREDENTIALS` | JSON 数组 | WorkBuddy 凭证 |
| `QODER_CREDENTIALS` | JSON 数组 | Qoder 凭证（含 PAT 或 token） |

---

### 方案二：QD（qiandao）框架

#### 第一步 — 上传模板

在 QD 面板「我的模板」中上传 `.har` 文件：

| 模板文件 | 平台 |
|---|---|
| `qd-templates/trae_checkin.har` | TRAE |
| `qd-templates/workbuddy_checkin.har` | WorkBuddy |
| `qd-templates/qoder_checkin.har` | Qoder |

#### 第二步 — 配置变量

创建 QD 任务时填入对应变量：

**TRAE 模板变量：**

| 变量名 | 说明 |
|---|---|
| `trae_host` | API 域名（如 `https://api.trae.cn`） |
| `trae_token` | JWT token |
| `trae_device_id` | 设备 ID |
| `trae_user_id` | 用户 ID |

**WorkBuddy 模板变量：**

| 变量名 | 说明 |
|---|---|
| `wb_token` | Bearer token |
| `wb_uid` | 用户 ID |
| `wb_enterprise_id` | 企业 ID（可选） |
| `wb_domain` | 域（可选） |

**Qoder 模板变量：**

| 变量名 | 说明 |
|---|---|
| `qoder_token` | Bearer token（job token） |

#### 第三步 — 设置定时

QD 任务定时示例：`0 8 * * *`（每天 8:00）

> **QD 模板限制：** QD 不支持 token 自动刷新。TRAE 和 Qoder 的 token 有效期较短，需定期用提取工具更新变量。WorkBuddy 无此问题。

---

## Qoder PAT 模式（推荐）

Qoder 支持通过 **PAT（Personal Access Token）** 认证，比从本地缓存提取更可靠：

1. 登录 [qoder.com.cn](https://qoder.com.cn)
2. 进入 **设置 → API Keys → 新建**
3. 复制 PAT（格式 `pt-xxxx`）
4. 运行提取：

```bash
node tools/extract-all-credentials.cjs --qoder-pat=pt-xxxx
```

签到时脚本会自动将 PAT 交换为短期 job token（参考 [pi-provider-qoder](https://github.com/simonsmh/pi-provider-qoder)），无需手动刷新。

也可以直接在环境变量的 JSON 中填写 `pat` 字段：

```json
[{ "pat": "pt-xxxx", "accountName": "我的账号" }]
```

---

## 多账号使用

### TRAE 多账号

1. 在 TRAE 桌面端登录账号 A
2. 运行 `node tools/extract-all-credentials.cjs --trae`，保存输出的 JSON
3. 在 TRAE 桌面端切换到账号 B
4. 再次运行提取脚本
5. 将两次提取的凭证合并为 JSON 数组，放入 `TRAE_CREDENTIALS`

```json
[
  { "token": "...", "refreshToken": "...", "accountName": "账号A", ... },
  { "token": "...", "refreshToken": "...", "accountName": "账号B", ... }
]
```

### WorkBuddy 多账号

同 TRAE 方式，在客户端切换账号后重新提取，合并为数组。

### Qoder 多账号

**PAT 模式：** 每个账号生成一个 PAT，合并为数组：

```json
[
  { "pat": "pt-accountA", "accountName": "账号A" },
  { "pat": "pt-accountB", "accountName": "账号B" }
]
```

**缓存模式：** 如果使用 [QoderWork Account Switcher](https://github.com/963072676/qoderwork-account-switcher) 管理多个账号，提取脚本会自动扫描所有账号并合并输出。

---

## 环境变量凭证格式

### TRAE_CREDENTIALS

```json
[
  {
    "token": "eyJhbGci...",
    "refreshToken": "ref_xxx",
    "expiresAt": 1234567890000,
    "refreshExpiresAt": 1234567890000,
    "deviceId": "device-uuid",
    "machineId": "machine-uuid",
    "userId": "user123",
    "accountName": "user@email.com",
    "host": "https://..."
  }
]
```

### WORKBUDDY_CREDENTIALS

```json
[
  {
    "token": "access_token_string",
    "uid": "12345",
    "enterprise_id": "",
    "domain": "cn"
  }
]
```

### QODER_CREDENTIALS（PAT 模式）

```json
[
  {
    "pat": "pt-xxxx",
    "accountName": "user@email.com"
  }
]
```

### QODER_CREDENTIALS（缓存模式）

```json
[
  {
    "token": "eyJhbGci...",
    "refreshToken": "ref_xxx",
    "machineToken": "P1gAmX...",
    "expiresAt": "2026-08-26T12:00:00.000Z",
    "accountName": "user@email.com"
  }
]
```

---

## Token 刷新机制

| 平台 | 刷新方式 | 自动刷新 | 说明 |
|---|---|---|---|
| TRAE | `ExchangeToken` 简化刷新（ClientID + RefreshToken + UserID） | 是 | 距过期 24 小时内自动刷新，使用 BoundDeviceID |
| WorkBuddy | 无 | - | 使用本地保存的 token |
| Qoder | PAT → job token 自动交换 | 是 | 每次签到前自动交换 PAT 为短期 job token |

### TRAE 刷新细节

参考 [baokun-l/trae-work-checkin](https://github.com/baokun-l/trae-work-checkin) 和 [iicookies/auto-checkin](https://github.com/iicookies/auto-checkin)，使用简化版刷新流程：

- 端点：`POST https://api.trae.com.cn/cloudide/api/v3/trae/oauth/ExchangeToken`
- Body：`{ ClientID, RefreshToken, ClientSecret: "-", UserID }`
- 签到端点：`POST https://api.trae.cn/trae/api/v2/ug/checkin_credits/claim`
- 认证头：`Cloud-IDE-JWT {token}` + `x-device-id`
- 使用刷新返回的 `BoundDeviceID` 作为设备 ID，避免 "Token device not match"
- 服务端限流（code 9074）时自动重试 3 次

### Qoder 刷新细节

参考 [pi-provider-qoder](https://github.com/simonsmh/pi-provider-qoder)：

- PAT 交换端点：`POST https://openapi.qoder.com.cn/api/v1/jobToken/exchange`
- 签到端点：`POST https://openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/claim`
- 签到 API 使用简单 Bearer 认证，无需 COSY 签名

---

## 平台对比

| 维度 | TRAE | WorkBuddy | Qoder |
|---|---|---|---|
| 签到接口 | `POST api.trae.cn/trae/api/v2/ug/checkin_credits/claim` | `POST www.codebuddy.cn/v2/billing/meter/daily-checkin` | `POST openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/claim` |
| 认证方式 | `Cloud-IDE-JWT {token}` + `x-device-id` | `Bearer {token}` + `X-User-Id` | `Bearer {job_token}` |
| Token 刷新 | ExchangeToken 简化刷新 | 无 | PAT → job token 交换 |
| 凭证来源 | `%APPDATA%/TRAE SOLO CN/` (AES 解密) | `%LOCALAPPDATA%/CodeBuddyExtension/` (明文 JSON) | PAT（推荐）或 `%APPDATA%/QoderCN/` 缓存 |
| 凭证提取平台 | 仅 Windows | Windows / macOS | 跨平台（PAT）/ 仅 Windows（缓存） |
| 多账号方式 | 切换桌面端账号重跑提取 | 切换客户端账号重跑提取 | 多 PAT 合并 / 自动扫描 |

---

## 平台支持矩阵

| 功能 | TRAE | WorkBuddy | Qoder |
|---|---|---|---|
| 青龙面板签到 | ✅ | ✅ | ✅ |
| QD 模板签到 | ✅ | ✅ | ✅ |
| 多账号 | ✅ | ✅ | ✅ |
| Token 自动刷新 | ✅ | - | ✅ |
| Windows 凭证提取 | ✅ | ✅ | ✅ |
| macOS 凭证提取 | - | ✅ | ✅ (PAT) |
| 纯 Node.js 无依赖 | ✅ | ✅ | ✅ |

所有脚本仅使用 Node.js 内置模块（`crypto`、`https`、`http`、`os`、`fs`、`path`、`child_process`），无需安装任何 npm 依赖。

---

## Qoder 凭证提取技术细节

### PAT 模式（推荐，跨平台）

通过 [qoder.com.cn](https://qoder.com.cn) 网站生成 PAT，签到时自动交换为 job token。无需 DPAPI、无需 SQLite，任何平台可用。

### 缓存模式（仅 Windows）

QoderCN 桌面客户端在 `SharedClientCache/cache/` 下保存明文缓存：

```
machine_token.json  → 机器 token (P1gAmX...)
status.json         → 账号信息 (username, email)
```

如需从 `state.vscdb` 提取用户 auth token，需要 Node.js 22+（内置 `node:sqlite`）或安装 `sqlite3` 命令行工具。

如遇问题，运行诊断工具排查：

```bash
node tools/qodercn-diagnostic.cjs
```

### auth-v2.dat 解密（QoderWork 旧版，仅 Windows）

QoderWork 桌面客户端使用 Electron safeStorage 加密凭证，解密链路：

```
Local State (JSON)
  └─ os_crypt.encrypted_key (base64)
       └─ base64 解码 → "DPAPI" (5B) + DPAPI 密文
            └─ Windows DPAPI 解密 → 32B AES-256 主密钥

auth-v2.dat (二进制)
  └─ "v10" (3B) + nonce (12B) + ciphertext + tag (16B)
       └─ AES-256-GCM 解密 → JSON (token, refresh_token, user, ...)
```

DPAPI 解密通过 PowerShell 调用 `System.Security.ProtectedData.Unprotect`，使用 `-EncodedCommand` 参数避免引号转义问题。必须以**登录用户身份**运行（不能用管理员或其他用户）。

---

## 常见问题

### Q: Token 过期了怎么办？

**TRAE：** 青龙脚本会自动刷新 token（ExchangeToken），无需干预。Refresh token 过期后（通常 30 天），需重新登录桌面客户端并重新提取凭证。

**Qoder：** 使用 PAT 模式时，每次签到自动交换新 job token，无需干预。如果使用缓存模式且 token 过期，请重新运行提取脚本。

**WorkBuddy：** 无 token 刷新机制。如果签到返回 401，请打开 WorkBuddy 客户端确认登录状态，然后重新提取凭证。

### Q: TRAE 报 "Token device not match"？

这是因为设备 ID 不匹配。脚本使用刷新返回的 `BoundDeviceID` 解决此问题。如果仍然报错，请确认提取的凭证包含正确的 `deviceId` 和 `userId`。

### Q: Qoder 报 "invalid token" 或 "token is not active"？

1. 如果使用缓存模式，token 可能已过期 — 推荐切换到 **PAT 模式**
2. 在 [qoder.com.cn](https://qoder.com.cn) → 设置 → API Keys → 新建 PAT
3. 运行 `node tools/extract-all-credentials.cjs --qoder-pat=pt-xxxx`
4. 更新青龙环境变量 `QODER_CREDENTIALS`

### Q: Qoder 提取报错 "DPAPI 解密失败"？

1. 确认在 Windows 上运行（不支持 macOS/Linux）
2. 确认以**登录用户身份**运行，不要用 `runas` 或管理员身份
3. 确认 Node.js 和 PowerShell 可用
4. 或直接使用 PAT 模式绕过此问题

### Q: 多账号签到会触发风控吗？

- 脚本在账号间间隔 3 秒，避免请求过快
- TRAE 为每个账号使用独立 `x-device-id`，避免设备级去重
- 服务端限流（9074）时自动重试

### Q: 青龙通知不生效？

脚本会尝试加载青龙的 `sendNotify` 模块。如果没有，仅在控制台输出。失败时退出码为 1，方便青龙感知并重试。

---

## 声明

本项目仅供学习交流。签到功能移植自上述开源项目，原始版权归原作者所有。请遵守各平台服务条款，合理使用。
