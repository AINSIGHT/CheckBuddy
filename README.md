AI CHECKIN · DAILY SIGNAL

# 🌱 AI CHECKIN ALL

**TRAE + WorkBuddy + Qoder · 三合一自动签到 · 按平台拆分 · 零 npm 依赖**

🔐 Token 永续 · ✅ 三平台独立模块 · 🔄 RT 轮换写回 · ✅ 签到回读确认 · 🩹 分钟级补签 · 🎮 互动玩法 · 💰 积分/用量/连签查询 · 📊 全中文报告 · 📢 七渠道推送 · 🐧 青龙友好 · ☁️ GitHub Actions · 📋 QD 模板

✨ 速览 · 🚀 青龙部署 · ☁️ Actions · 📋 QD · 💻 本地 · 🔐 凭证获取 · 🔧 环境变量 · ⌨️ 命令行 · 🌱 WorkBuddy 流程 · 🧠 智能特性 · 📊 报告示例 · 📁 目录结构 · 🆚 平台对比 · ❓ 排错 · 🚫 使用边界

----------------------------------------

## 🚫 使用边界与免责声明

> **Important**
> 本项目仅供**学习与个人自动化**使用。请遵守各平台服务条款，使用风险自负。
> 成长任务与活跃事件自动化属于灰色地带，相关写操作**默认关闭**，需显式开启；脚本不破解客户端、不绕过风控，只调用官方 HTTP 接口并如实回读结果。

> 🔒 所有凭据均由环境变量（或 GitHub Secrets）注入，仓库内不含任何账号、手机号、Token 或设备信息。请妥善保管 `wb_refresh_tokens.json`、`wb_login_result.json`、`.env` 等文件 —— 它们已被 `.gitignore` 屏蔽，**切勿手动提交**。

> ⚠️ `WORKBUDDY_REFRESH_TOKEN` 里的 RT 是唯一的续期凭据，泄露后别人可以操作你的账号。日志、报告与推送内容一律不输出 token 明文。

----------------------------------------

## ✨ 30 秒速览

| 维度 | 说明 |
|---|---|
| 做什么 | 自动完成 TRAE / WorkBuddy / Qoder 三平台每日签到；WorkBuddy 额外支持令牌续期、积分查询、补签队列与成长任务发现 |
| 输入 | `TRAE_CREDENTIALS` / `WORKBUDDY_CREDENTIALS` / `WORKBUDDY_REFRESH_TOKEN` / `QODER_CREDENTIALS`，全部可选、配哪个跑哪个 |
| 输出 | 中文分平台分账号报告、积分前后差值、签到连签、待办分布、多渠道推送 |
| 部署 | 青龙面板、GitHub Actions、QD（qiandao）框架、Windows / Linux 本地运行 |
| 依赖 | **Node.js ≥ 18**，仅内置模块（`https` `crypto` `fs` `readline`），无需 `npm install` |
| 成功判据 | 签到状态、任务进度与领奖结果均回读确认；不以单个 HTTP 200 冒充任务完成 |

----------------------------------------

## ✨ 这是什么

一个入口跑完三个平台的签到，每个平台是独立模块，可单独启用：

> 🎯 **一句话**：配好凭证，剩下交给它；WorkBuddy 再补一个 RT，令牌就永不过期。
>
> 📦 **按平台拆分**：`platforms/trae.js`、`platforms/qoder.js`、`platforms/workbuddy/`，公共能力收在 `lib/`，新增平台只需在注册表加一行。
>
> ☁️ **四端部署**：青龙、GitHub Actions、QD 模板、本地命令行，配置模板统一放在 `env.template/`。
>
> 🔄 **平滑兼容**：旧环境变量、旧定时任务 `task checkin_all.js`、QD 的 `.har` 模板全部不用改。

----------------------------------------

## 📁 目录结构

```
.
├── checkin.js                       # 主入口：CLI + 平台编排 + 报告 + 退出码
├── checkin_all.js                   # 兼容 shim（旧青龙任务继续可用）
├── lib/
│   ├── http.js                      # HTTP + 退避重试（保留 TLS 证书校验）
│   ├── env.js                       # 环境变量 / CLI 参数 / 北京时间
│   ├── state.js                     # 原子写 + 跨进程文件锁
│   ├── errors.js                    # 统一鉴权失败判定
│   ├── credentials.js               # 本地凭证文件回退加载
│   ├── notify.js                    # 青龙 + 7 渠道 webhook
│   └── report.js                    # 中文汇总报告
├── platforms/
│   ├── index.js                     # 平台注册表
│   ├── trae.js                      # TRAE（ExchangeToken 刷新 + 签到）
│   ├── qoder.js                     # Qoder（PAT → job token + 签到）
│   └── workbuddy/
│       ├── index.js                 # 编排
│       ├── credentials.js           # 三种凭证归一化 + JWT 体检 + 令牌库
│       ├── refresh.js               # RT 续期与轮换写回
│       ├── checkin.js               # 签到状态机
│       ├── sign-retry.js            # 补签队列
│       ├── query.js                 # 积分 / 用量 / 连签 / 热力图
│       ├── activity.js              # 活跃事件上报（默认关闭）
│       ├── growth.js                # 成长任务发现（默认只读）
│       └── games.js                 # 互动玩法（默认关闭）
├── tools/
│   ├── workbuddy-login.cjs          # 短信验证码登录，输出 手机号:AT:RT
│   ├── extract-all-credentials.cjs  # 三平台凭证提取（含加密信封检测）
│   ├── save-credentials.cjs         # 把环境变量落盘为每个平台一份凭证 JSON
│   └── qodercn-diagnostic.cjs       # QoderCN 诊断
├── env.template/                    # 🔧 所有环境变量模板（见下方索引）
├── qd-templates/                    # QD 模板：trae / workbuddy / qoder 三个 .har
├── .github/workflows/checkin.yml    # Actions 定时 + 私有仓库令牌库回写
└── README.md
```

----------------------------------------

## 🚀 部署方式一：青龙面板（三步）

| 步骤 | 操作 |
|---|---|
| 1️⃣ 上传脚本 | 订阅本仓库，或把整个目录放入青龙 `scripts/` |
| 2️⃣ 设置变量 | 按 `env.template/qinglong.env`，在「环境变量」里添加至少一个账号凭证 |
| 3️⃣ 定时任务 | 日常 `5 10 * * *` · 补签 `10-50/10 9-11 * * *`（面板本地时间） |

| 用途 | 命令 | Cron |
|---|---|---|
| 日常全流程 | `task checkin.js` | `5 10 * * *` |
| 补签队列（可选） | `task checkin.js --sign-retry-only` | `10-50/10 9-11 * * *` |
| 夜猫窗口（开启成长任务后） | `task checkin.js --only workbuddy` | `37 23 * * *` |

> ⏰ **为什么是 10:05**：Qoder 的每日额度轮次约在 **10:00（北京时间）** 才刷新，太早跑会拿到「本轮活动未下发」。若必须更早执行，可设 `QODER_WAIT=5`（每 60 秒重查，最多等 5 分钟）或单独给 Qoder 排一个 10:05 的任务。
>
> 🐧 **命令必须用青龙运行器（高频坑）**：定时任务命令填 `task checkin.js`，不要填裸 `node checkin.js` —— 裸 `node` 调用不会注入面板环境变量，脚本会直接报「未设置任何环境变量」。
>
> 📌 建议设置 `STATE_DIR=/ql/data`（或任意持久目录），避免升级覆盖脚本目录时，轮换后的令牌库被一并替换。
>
> 📢 **通知**：面板里配了啥通知就用啥，连 webhook 都不用填；青龙 2.18+ 可另配 `QL_CLIENT_ID` / `QL_CLIENT_SECRET` 走 `/open/auth/token` → `PUT /open/system/notify`。

----------------------------------------

## ☁️ 部署方式二：GITHUB ACTIONS（零服务器）

> 内置工作流 `.github/workflows/checkin.yml`，Import / 上传到自己账号即可开启云端定时签到。

**第 1 步 · 添加 SECRETS**（仓库 → Settings → Secrets and variables → Actions）

完整清单见 [`env.template/actions-secrets.md`](env.template/actions-secrets.md)，常用的几个：

| Secret 名称 | 说明 |
|---|---|
| `TRAE_CREDENTIALS` | TRAE 凭证 JSON 数组 |
| `WORKBUDDY_CREDENTIALS` | WorkBuddy 凭证 JSON 数组 |
| `WORKBUDDY_REFRESH_TOKEN` | 推荐，`手机号:AT:RT`，多账号换行分隔 |
| `QODER_CREDENTIALS` | Qoder 凭证 JSON 数组（推荐 PAT） |
| `NOTIFY` + 各推送 token | 可选，推送策略与渠道 |

**第 2 步 · 开启 ACTIONS**：进入 `Actions` 标签页，若提示需要启用，点 `I understand my workflows, go ahead and enable them`。

**第 3 步 · 手动跑一次验证**：`Actions → 🌱 三合一签到 → Run workflow`，`mode` 选 `full`，看到 ✅ 即部署成功。手动运行还支持 `refresh` / `query` / `retry` 三种模式。

**内置定时（北京时间）**

| 时间 | UTC cron | 说明 |
|---|---|---|
| 10:05 | `5 2 * * *` | 日常全流程（Qoder 轮次 10:00 刷新后再跑） |
| 23:37 | `37 15 * * *` | 夜猫窗口（成长任务开启后有用） |

> 🕐 工作流已设置 `TZ: Asia/Shanghai` —— 否则 runner 默认 UTC，会导致日志时间显示错误、补签日期算错一天。脚本内部也用 `beijingNow()` / `beijingToday()` 强制北京时间，双保险。
>
> 🔒 **令牌状态与安全**：RT 每次续期都会轮换。工作流**仅在私有仓库**把 `wb_refresh_tokens.json` 提交回仓库，公开仓库自动跳过，避免 RT 泄露。GitHub 不允许修改 Fork 仓库的可见性，所以想要「私有仓库 + 令牌持久化」请用 `https://github.com/new/import` 导入为 Private，或新建私有仓库手动上传。
>
> ⚠️ 若继续使用公开仓库，令牌不会持久化，每次运行都依赖 `WORKBUDDY_REFRESH_TOKEN` 这个 Secret 提供最新 RT。

> ⏰ **定时不触发排查顺序**
> 1. 默认分支：schedule 只在仓库默认分支生效，Import 后若默认分支是 `master` 而 workflow 在 `main`，定时永远不会触发
> 2. Actions 开关：Settings → Actions → General 确认允许，Actions 页确认 workflow 未被 disabled
> 3. Fork 限制：Fork 仓库默认禁用定时 workflow，必须手动启用
> 4. 60 天无活动：GitHub 会自动停用长期无活动仓库的 schedule，手动跑一次或 push 一个 commit 可重新激活
> 5. cron 是 UTC：北京时间要减 8 小时
> 6. 看 Actions 记录：只有 `workflow_dispatch` 没有 `schedule`，基本就是上面 1/2/3/4 之一
> 7. schedule 是 best-effort：高峰期可能延迟数分钟到数小时，甚至跳过；需要精确时间请用 `workflow_dispatch`

----------------------------------------

## 📋 部署方式三：QD（QIANDAO）框架

在「我的模板」上传 `qd-templates/*.har`，创建任务时按 [`env.template/qd-variables.md`](env.template/qd-variables.md) 填变量：

| 模板 | 变量 |
|---|---|
| `trae_checkin.har` | `trae_host` `trae_token` `trae_device_id` `trae_user_id` |
| `workbuddy_checkin.har` | `wb_token` `wb_uid` `wb_enterprise_id` `wb_domain` |
| `qoder_checkin.har` | `qoder_token` |

> ⚠️ **QD 不支持 token 自动刷新**：TRAE / Qoder 的短期令牌需定期用提取工具更新变量；WorkBuddy 强烈建议改用青龙或 Actions，以启用 RT 续期。定时示例 `0 8 * * *`。

----------------------------------------

## 💻 部署方式四：本地

```bash
npm run checkin:dry          # 先预演，不发任何请求
npm run login:workbuddy      # 短信登录拿 手机号:AT:RT
npm run refresh              # 仅刷新 WorkBuddy 令牌
npm run query                # 只读查询积分/用量/连签
npm run checkin              # 真实签到
npm run extract              # 三平台凭证提取
```

> 📌 `.env` 文件不会被脚本自动读取（需 `source`）；但**本地凭证 JSON 文件会自动加载**，见下一节。

----------------------------------------

## 💻 本机测试与本地凭证（推荐从这里开始）

**可以本机直接测**：Node.js ≥ 18、零第三方依赖，不需要 `npm install`。

**第 1 步 · 拿凭证并保存一版**（任选其一，每个平台各存一份）

| 方式 | 命令 | 产出文件 |
|---|---|---|
| 三平台桌面端提取 | `npm run extract` | `trae-credentials.json` · `workbuddy-credentials.json` · `qoder-credentials.json` |
| WorkBuddy 短信登录 | `npm run login:workbuddy` | `wb_login_result.json`（支持多账号，按手机号去重；`--export` 导出多行值） |
| 已配好环境变量，落盘一版 | `npm run save:creds` | 同上三份 JSON |

> 🔒 这些文件以 **0600** 权限原子写入，且全部已被 `.gitignore` 屏蔽（含 `wb_login_result.json`、各类令牌库），**切勿提交或外传**。日志只显示文件名与账号数，不打印 token。

**第 2 步 · 自动加载规则**

- **环境变量始终优先**；只有对应变量为空时，才读工作目录下这几个固定文件名
- 优先级：`WORKBUDDY_REFRESH_TOKEN` / `wb_login_result.json` **高于** `workbuddy-credentials.json`，避免同一账号被加载两次
- `LOCAL_CREDS=0` 可完全关闭本地文件加载（青龙 / Actions 上无这些文件，不受影响）
- 加载时日志会显示 `📂 已从本地凭证文件加载: ...`

**第 3 步 · 按顺序验证**

```powershell
node checkin.js --dry-run                  # ① 不联网：确认加载了哪些平台/账号
node checkin.js --only workbuddy --query   # ② 只读：验证 token 可用、查积分
node checkin.js --only workbuddy           # ③ 单平台真实签到
node checkin.js                            # ④ 三平台全流程
```

> ⚠️ 第 ③ 步起会真实调用第三方签到接口，请先确认服务条款；首次强烈建议用 `--only` 限定单平台。
>
> 💡 若不想用文件、只想临时用环境变量（PowerShell）：
> ```powershell
> $env:WORKBUDDY_REFRESH_TOKEN = '手机号:AT:RT'
> node checkin.js --dry-run
> ```
> 建议把 `STATE_DIR` 指到持久目录，避免刷新后的令牌库被覆盖。

----------------------------------------

## 🔐 凭证获取

### 三平台提取工具

```bash
node tools/extract-all-credentials.cjs                      # 全部
node tools/extract-all-credentials.cjs --trae              # 仅 TRAE
node tools/extract-all-credentials.cjs --workbuddy         # 仅 WorkBuddy
node tools/extract-all-credentials.cjs --qoder             # 仅 Qoder（缓存模式）
node tools/extract-all-credentials.cjs --qoder-pat=pt-xxxx # Qoder PAT（推荐）
```

输出可直接粘贴的 JSON，同时保存为 `trae-credentials.json` / `workbuddy-credentials.json` / `qoder-credentials.json`。

### 短信验证码登录（WorkBuddy 推荐 · 支持多账号）

**一次可连续登录多个手机号**：按手机号去重保存（重复登录同一号码会**覆盖**旧条目，不会重复签到），`wb_login_result.json` 是 JSON 数组，主脚本会把所有 `env_line` 拼成多行 `WORKBUDDY_REFRESH_TOKEN`。

```bash
# ① 交互式批量登录（推荐）：逐个输入手机号 → 收验证码 → 问是否继续添加
node tools/workbuddy-login.cjs

# ② 单账号模式（兼容旧用法）
node tools/workbuddy-login.cjs 13800000000
node tools/workbuddy-login.cjs 13800000000 123456   # 免交互
node tools/workbuddy-login.cjs --check              # 登录后额外只读校验 AT

# ③ 账号管理（不发短信）
node tools/workbuddy-login.cjs --list               # 列出已保存账号（脱敏，不打印 token）
node tools/workbuddy-login.cjs --export             # 输出完整多行 WORKBUDDY_REFRESH_TOKEN
node tools/workbuddy-login.cjs --remove 13800000000
node tools/workbuddy-login.cjs --clear              # 清空（需输入 yes，--yes 跳过）
```

> 📌 `npm run` 传参要加 `--`：`npm run login:workbuddy -- --list`。`--export` 的输出可整段粘到青龙「环境变量」或 GitHub Secrets，多行即多账号。
>
> 📁 凭证库保存在**当前工作目录**的 `wb_login_result.json`（与主脚本读取目录一致）；换目录运行会读写另一份。

```
╔══════════════════════════════════════════════╗
║ 🔐 WorkBuddy 短信验证码登录工具 (多账号版)     ║
╚══════════════════════════════════════════════╝
  ✅ 目标: https://www.workbuddy.cn
  📁 凭证库: ...\wb_login_result.json
  ℹ️ 多账号模式：可连续登录多个手机号，直接回车结束

  📱 手机号（直接回车结束）: 13800000000
  ✅ 验证码已发送（有效期 300 秒）
  📱 请输入收到的验证码: ******
  ✅ 登录成功 | 138****0000 | AT 过期: 2026-12-11 08:30
  💾 已保存，当前共 1 个账号（同手机号自动覆盖）
  ➕ 继续添加下一个账号？(y/N): y
  ...
════════════════════════════════════════════════════════════
💾 已保存 2 个 WorkBuddy 账号
════════════════════════════════════════════════════════════
```

> 🛠️ **实现说明**：走官方插件登录接口 `/v2/plugin/login/send-sms` 与 `/v2/plugin/login/token`，由服务端直接下发明文 `accessToken` / `refreshToken`，不再解析 Keycloak 登录页表单 —— 这是解决「验证码正确却提示验证码错误」的关键。
>
> ✅ `--check` 只调只读查询接口验 AT，**绝不触碰刷新端点**，因此不会因 RT 轮换把刚拿到的 RT 弄失效。凭证库用文件锁 + 原子写、0600 权限，按手机号 upsert；加载侧再按手机号去重一次，兼容历史重复条目。全程保留 TLS 证书校验，日志不打印 token 明文。

> ⛔ **WorkBuddy 5.6.2+ 的变化**：客户端默认开启 AtRestEncryption，认证文件里的 AT/RT 是 `{"$wbEncrypted":1,"envelope":"……"}` 加密信封，解密密钥只驻留客户端进程内存、不落盘 —— 这种值没法直接用，提取工具会明确报错，请改用短信登录。自检：以 `eyJ` 开头 = 明文可用；含 `envelope` = 信封不可用。

### WorkBuddy 三种凭证格式（可混用，自动合并去重）

| 变量 | 格式 | 说明 |
|---|---|---|
| `WORKBUDDY_CREDENTIALS` | `[{ "token": "...", "uid": "12345", "enterprise_id": "", "domain": "cn" }]` | **v1 旧格式，完全兼容**；无 RT 时以只读 AT 模式运行 |
| `WORKBUDDY_CREDENTIALS` | `[{ "token": "...", "refreshToken": "...", "phone": "138..." }]` | 提取工具新版输出，自动续期 |
| `WORKBUDDY_REFRESH_TOKEN` | 多行 `手机号:AT:RT`（AT 可留空 → `手机号::RT`） | 推荐，与上游 WorkBuddy-Daily 同款格式 |

> ⚠️ AT 与 RT 之间用**英文冒号**分隔；等号后面的引号不要带。顺序必须是 `手机号:AT:RT`（RT 的 `typ=Offline`，粘反了体检会直接提示）。

### Qoder PAT（推荐）

登录 [qoder.com.cn](https://qoder.com.cn) → 设置 → API Keys → 新建，把 `pt-xxxx` 填进 `--qoder-pat=`，或直接写进 JSON：

```json
[{ "pat": "pt-xxxx", "accountName": "我的账号" }]
```

签到时自动把 PAT 交换为短期 job token（`POST /api/v1/jobToken/exchange`），无需手动刷新。

### 多账号

切换桌面端账号后重跑提取工具，把多个对象合并为 JSON 数组；`WORKBUDDY_REFRESH_TOKEN` 直接换行追加即可。

----------------------------------------

## 🔧 环境变量

> 📁 **所有需要配置的变量模板都在 [`env.template/`](env.template/) 目录下**，按部署场景分好，挑一个用即可：

| 文件 | 适用场景 | 怎么用 |
|---|---|---|
| `env.template/.env.example` | 本地 / shell / 自建容器 | `cp` 成 `.env` → 编辑 → `source .env` |
| `env.template/qinglong.env` | 青龙面板 | 「环境变量」逐条添加，或「配置文件」导入 |
| `env.template/actions-secrets.md` | GitHub Actions | `Settings → Secrets` 按名称逐个新建 |
| `env.template/qd-variables.md` | QD 框架 | 创建任务时填模板变量（非环境变量） |

| 分组 | 变量 | 必填 |
|---|---|---|
| 账号凭证 | `TRAE_CREDENTIALS` `WORKBUDDY_CREDENTIALS` `WORKBUDDY_REFRESH_TOKEN` `QODER_CREDENTIALS` | 至少一个 |
| Qoder 等待窗口 | `QODER_WAIT` | 可选，默认 `0`（不等待）；轮次未下发时每 60 秒重查，最多 30 分钟 |
| TRAE 客户端谱系 | `TRAE_CLIENT_ID` `TRAE_REQ_SOURCE` | 可选；默认自动 IDE→SOLO 回退（IDE: `ono9krqynydwx5`/`1`，SOLO: `en1oxy7wnw8j9n`/`2`），`req_source` 与 token 不匹配时会 9074 |
| TRAE 设备证明 | `TRAE_DEVICE_KEY_PEM` `TRAE_DEVICE_PUB_PEM` `TRAE_DEVICE_ID` `TRAE_MACHINE_ID` | 可选；新版续期（20405）需要。本地运行时凭证 JSON 已含密钥，零配置；青龙/Actions 才需要填 |
| Qoder 设备头 | `QODER_CLIENT_TYPE` `QODER_MACHINE_TOKEN` `QODER_MACHINE_CODE` `QODER_MACHINE_TYPE` `QODER_MACHINE_ID` `QODER_MACHINE_OS` `QODER_MACHINE_HOSTNAME` `QODER_SASH_UA` `QODER_EXTRA_HEADERS` | 可选；凭证 JSON 内嵌 `machineToken/machineType` 时零配置，青龙/Actions 补环境变量即可 |
| Qoder 地区 | `QODER_REGION` `QODER_BASE` | 可选；默认 `cn`（openapi.qoder.com.cn），token 失效时自动用 `drt-` 续期并自动探测国际版（openapi.qoder.sh） |
| WorkBuddy 进阶 | `WB_BASE_URL` `WB_X_DOMAIN` `STATE_DIR` `WB_GAP` `WB_MAKEUP_MAX_PER_RUN` `WB_TASKS` `WB_SKIP_TASKS` `WB_GROWTH_DISCOVER` `WB_GROWTH_WRITE` `WB_ACTIVITY_CONFIRM` | 可选 |
| 互动玩法 | `WB_GAMES` `WB_GAMES_TASKS` `WB_GAMES_SKIP` `WB_GAMES_BASE_URL` `WB_GAMES_MAX_DRAWS` `WB_GAMES_MAX_BLINDBOX` | 可选，默认关闭 |
| 本地凭证 | `LOCAL_CREDS` | 可选，默认 `1`（环境变量为空时读取本地凭证 JSON）；置 `0` 关闭 |
| 通知 | `NOTIFY` `BARK_URL` `PUSHPLUS_TOKEN` `WXPUSHER_APP_TOKEN` `WXPUSHER_UID` `SERVERCHAN_SENDKEY` `WECOM_WEBHOOK` `DINGTALK_WEBHOOK` `DINGTALK_SECRET` `QL_CLIENT_ID` `QL_CLIENT_SECRET` `QL_URL` | 可选 |

> ⚠️ **脚本只读取 `process.env`，不会自动加载 `.env` 文件**。本地必须显式 `source`，或用 `set -a; source .env; set +a` 注入。`.env` 已被 `.gitignore` 屏蔽，模板 `.env.example` 可以提交，但不要把真实 token 写进任何模板文件。
>
> ✅ 但**本地凭证 JSON 文件会自动加载**（`*-credentials.json` / `wb_login_result.json`），见「💻 本机测试与本地凭证」；`LOCAL_CREDS=0` 可关闭。
>
> 💡 `STATE_DIR` 也可写作 `WB_STATE_DIR` / `WORKBUDDY_STATE_DIR`；不设则为脚本同级目录。`WB_GROWTH_WRITE=1` 与 `WB_ACTIVITY_CONFIRM=1` 属于写操作开关，默认关闭。

----------------------------------------

## ⌨️ 命令行参数

```bash
node checkin.js                               # 全平台全流程
node checkin.js --only workbuddy              # 只跑指定平台（支持 wb / tr / qd 别名）
node checkin.js --dry-run                     # 只打印计划，不发任何请求
node checkin.js --refresh                     # 仅刷新 WorkBuddy 令牌
node checkin.js --query                       # 仅只读查询
node checkin.js --sign-retry-only             # 仅处理补签队列
node checkin.js --gap 2                      # 账号间隔秒数（默认 3）
node checkin.js --tasks checkin,travel --skip-tasks lottery
node checkin.js --notify always|fail|0        # 推送策略
node checkin.js --state-dir /ql/data          # 覆盖状态目录
node checkin.js --activity-confirm            # 临时开启活跃上报
node checkin.js --growth-write                # 临时开启成长任务写操作
node checkin.js --games                      # 临时开启互动玩法
node checkin.js --games-tasks lottery,travel # 只跑指定玩法
node checkin.js --games-skip lottery         # 跳过指定玩法
```

> 🎛️ `--refresh` / `--query` / `--sign-retry-only` 是 WorkBuddy 专属模式，会自动只加载 WorkBuddy 平台。失败时 `exit 1`，方便青龙感知并重试。

----------------------------------------

## 🌱 WorkBuddy 流程详解

### Token 永续

```
WORKBUDDY_REFRESH_TOKEN（手机号:AT:RT）
  → 本地 JWT 体检（typ=Offline、三段式、签发域、加密信封）
  → wb_refresh_tokens.json 令牌库（原子写 + 文件锁，只存 UID 哈希）
  → 按需刷新：无 AT / AT 7 天内过期 / 距上次刷新 > 10 天
  → POST https://copilot.tencent.com/v2/plugin/auth/token/refresh
       X-Refresh-Token · X-Auth-Refresh-Source: plugin
       Authorization · X-User-Id · X-Request-ID · X-Domain
  → 服务端轮换下发新 AT + 新 RT → 立即原子写回
  → 运行中接口 401：用该账号 RT 续期一次并重试
```

> 🔄 刷新请求头由 `refresh.js` 统一生成，登录工具与主脚本共用一套指纹；AT/uid 缺失时退回纯 RT 形态，不伪造身份。全程保留 TLS 证书校验。

### 签到状态机

1. 查 `/v2/billing/meter/checkin-activity-status`（失败回退 `checkin-status`）；活动未开放不算失败，今日已签直接跳过
2. `POST /v2/billing/meter/daily-checkin`，网络异常 / 5xx 做 2s、4s 退避重试（最多 2 次）
3. **回读状态确认**，处理 `credit_delayed=true`（积分待入账）；回读不可用时标记「待确认」，下轮自动复查
4. 只有 `500 + code=10001 + 稍后重试` 才进补签队列；`400+10001`（企业号）、普通 429、`500+10000` 均不入队
5. 企业号自动识别并跳过签到与成长体系；`11140 / request illegal` 判账号受限，`11-128` 判渠道指纹拦截

> ✅ **空回执、业务错误或状态未确认都不再打印成「签到成功」** —— 这是与旧版最大的区别。
>
> 🩹 补签队列只保存 UID 哈希，从首次失败时刻起在第 **10 / 40 分钟**各补一次；每次先查官方状态，已签立即清队列。外部 cron 用 `--sign-retry-only` 触发，不跑完整任务套件。

### 查询与报告

只读端点：`get-user-resource-summary`（积分余额）、`get-user-resource`（用量）、`/activity/growth/streak`（活跃连签）、`/v2/activity/growth/heatmap`（今日 score）。

> 🧭 报告把「**签到连签**」（积分签到活动 `streak_days`）与「**活跃连签**」（成长中心热力墙，由使用事件驱动）分开显示 —— 后者为 0 属正常，不是签到失败。

### 成长任务（默认只读）

三源清单合并（`/v2/activity/growth/tasks` 桌面、`/activity/growth/tasks` 等级族、`X-Client-Platform: miniprogram` 小程序口径），输出任务数、未适配的新任务提示、7 天内到期提醒。写操作（accept / claim、按 `progress.current >= progress.target` 补领）**默认关闭**，需 `WB_GROWTH_WRITE=1` 或 `--growth-write`。

### 互动玩法（默认关闭）

`WB_GAMES=1` 或 `--games` 开启，且**只在签到成功后**执行。端点与回执字段对齐上游实测源码，全部先查状态再写、写后回读：

| 玩法 | 别名 | 做了什么 |
|---|---|---|
| 抽奖 | `lottery` | `lottery/chances` 查次数（失败回退 `lottery/summary`）→ 逐次 `lottery/draw`，识别实物奖并提示填写收货地址 |
| 盲盒 | `blindbox` | 仅在旅行状态确认 `idle` 时，按 `buddy/quota.affordable` 开盒（默认最多 5 个），读 `instance/template` 名称与稀有度 |
| Buddy 信息 | `buddy_info` | 纯只读，展示名称 / 稀有度 / 性格 |
| 派猫猫旅行 | `travel` | `buddy/visible` → `travel/status` → `arrived` 时用服务端 `record_id` 领奖且回执含 `reward_credit` 才算到账 → 回读确认 `idle` → 按当日名额 `travel/depart` 派出下一趟 |

> 🔁 执行顺序：**旅行前置 → 盲盒 → 派出 → Buddy 信息 → 抽奖**。旅行中、领奖失败、领取后状态未回到空闲或状态未知时，都不会开盒也不会派出。
>
> 🎛️ 若用 `WB_GAMES_TASKS=blindbox` 只开盲盒，脚本仍会做一次**只读**旅行探测（只查状态、绝不领奖），确认 `idle` 后才开盒；探测到 `arrived` 会明确跳过并提示。
>
> 🧩 本地防重 `wb_games_state.json`（按 UID 哈希隔离）保证每日只派出一次；服务端 `daily_limit_reached` 再兜底。玩法失败只写进报告明细，**不影响签到结果**。
>
> 🎛️ `WB_GAMES_TASKS` / `WB_GAMES_SKIP` 可裁剪玩法；`WB_GAMES_MAX_DRAWS`（默认 20）与 `WB_GAMES_MAX_BLINDBOX`（默认 5）是单轮上限保护，防止异常次数导致刷接口。

> ⚠️ **本次只集成这 4 项**。连签兑换 `redeem`、补签卡 `makeup`、礼包补偿 `gift`、徽章 `badges` 的端点与回执结构未能从上游可读取的源码中核实，且涉及活动期 / 日历断点 / 期次防重，不属于「最简单」范围，暂不发送任何写请求。日志会明确列出未集成项，待拿到真实回执后再补齐。

### 主要端点

| 用途 | 端点 |
|---|---|
| 登录 / 刷新 | `/v2/plugin/login/send-sms`、`/v2/plugin/login/token`、`copilot.tencent.com/v2/plugin/auth/token/refresh` |
| 签到 | `/v2/billing/meter/checkin-activity-status`、`/v2/billing/meter/daily-checkin` |
| 查询 | `/billing/meter/get-user-resource*`、`/activity/growth/streak`、`/v2/activity/growth/heatmap` |
| 任务 | `/v2/activity/growth/tasks`、`/v2/activity/growth/tasks/accept`、`/activity/growth/tasks/{code}/claim` |
| 玩法 | `/v2/activity/growth/lottery/chances\|summary\|draw`、`/v2/activity/growth/buddy/quota\|open\|info\|visible`、`/v2/activity/growth/buddy/travel/status\|claim\|config\|depart` |
| 活跃 | `/v2/report` |

----------------------------------------

## 🧠 智能特性

- 📊 **全中文报告**：按平台/账号分块 + 总计 + 待办分布，积分、连签一目了然
- 🔐 **Token 永续**：RT 轮换写回 `wb_refresh_tokens.json`，线程/进程锁 + 原子替换，不再手工重提凭证
- 🔍 **凭据体检**：不联网校验三段式 JWT、`typ=Offline`、签发域、加密信封，把 `token format error` 翻译成「粘反了 / 粘错文件 / 被截断」
- ♻️ **幂等补缺**：所有流程先查状态再执行，重复运行零副作用
- 🔄 **刷新结果持久化**：TRAE 轮换后的 token / RT / 设备号原子写回 `trae_tokens.json`，不再每轮拿旧环境变量重刷
- 🛡️ **统一鉴权判定**：`code=1001` 与 HTTP 401/403 三平台一致处理，不再把鉴权失败误报成「今日已领取」
- 🔁 **状态预查与复查**：TRAE 领取前先查状态；`9074` 不再无意义重试（上游实测其根因是设备号不被认可）；`9004/9095` 按「该设备今日已签」计成功
- ⏳ **Qoder 轮次等待**：`QODER_WAIT` 可在本轮活动未下发时每 60 秒重查；PAT 交换双字段名 + HTTP 400 明确分类
- 📂 **本机零配置测试**：`npm run extract` / `save:creds` 按平台各存一份凭证 JSON，环境变量为空时自动加载；0600 权限 + gitignore 屏蔽 + 日志脱敏
- ⏰ **智能续期**：距上次刷新 > 10 天或 AT 7 天内过期才刷新，避免无谓轮换
- 🔄 **API 重试**：网络错误 / 5xx 指数退避；业务错误不重试；`--gap` 可调账号间隔防频控
- 🩹 **分钟级补签**：10 / 40 分钟两次，状态文件只存 UID 哈希
- ✅ **accept 后回读**：签到领奖以官方状态确认，不以 HTTP 200 冒充完成
- 🧩 **双域名回退**：业务域 `www.codebuddy.cn` 失败自动回退 `www.workbuddy.cn`，`WB_BASE_URL` 可覆盖
- 🛡️ **单账号隔离**：任一账号异常只跳过该账号，不中断整轮；运行中 401 自动续期重试
- 🏢 **企业号识别**：`400 + 10001` 判企业账号，跳过签到与成长体系，不误报为凭据失效
- 🌱 **成长任务三源发现**：桌面 / 等级族 / 小程序口径合并，未适配任务与到期任务主动提示
- 🎛️ **任务白黑名单**：`WB_TASKS` / `WB_SKIP_TASKS` 自由裁剪，写操作默认关闭
- 🎮 **互动玩法幂等**：抽奖 / 盲盒 / Buddy 信息 / 猫猫旅行，先查状态再写、写后回读、状态未知即跳过，本地按 UID 哈希做当日防重
- 🕐 **北京时间双保险**：`TZ: Asia/Shanghai` + `beijingNow()`，补签日期不会算错一天
- 📢 **多渠道推送**：青龙面板、Bark、PushPlus、WxPusher、Server酱、企业微信、钉钉，配哪个推哪个
- 🧹 **零依赖**：仅 Node 内置模块，Actions 里连 `npm install` 都不需要

----------------------------------------

## 📢 通知

| 变量 | 渠道 |
|---|---|
| 青龙 `sendNotify` | 面板自带通知，自动探测，无需任何配置 |
| `QL_CLIENT_ID` + `QL_CLIENT_SECRET` | 青龙 2.18+：`GET /open/auth/token` → `PUT /open/system/notify` |
| `BARK_URL` | Bark（iOS） |
| `PUSHPLUS_TOKEN` | PushPlus |
| `WXPUSHER_APP_TOKEN` + `WXPUSHER_UID` | WxPusher（多 UID 逗号分隔） |
| `SERVERCHAN_SENDKEY` | Server酱（`sctp` 开头自动走方糖专属通道） |
| `WECOM_WEBHOOK` | 企业微信群机器人（完整 URL 或仅 key） |
| `DINGTALK_WEBHOOK` + `DINGTALK_SECRET` | 钉钉群机器人（支持加签 HMAC-SHA256） |

> `NOTIFY=always`（默认，每次推）/ `fail`（仅本轮有异常时推）/ `0`（关闭 webhook，控制台与青龙面板通知仍保留）。

----------------------------------------

## 📊 推送报告示例

```
📊 签到汇总 · 2026-11-12 10:05 (北京时间)

【TRAE】
  ✅ 账号A: 签到成功 (+200)
【WorkBuddy】
  ✅ 138****0000: 签到成功 (+100 积分) 连7天
     · 💰 主套餐剩余 980 积分(共 1000，已用 20)
     · 📊 共 12 类资源，本月用量已查询
     · 🔥 活跃连签 7 天（由使用事件驱动，与积分签到连签不同）
     · 🎮 互动玩法: lottery、blindbox、buddy_info、travel
     · 🐾 领取到达礼物 +50 积分 / 回读确认已回到 idle
     · 📦 盲盒: 开出 小煤球(稀有)
     · 🎰 抽奖: 10 积分、5 能量
  ✅ 138****5678: 今日已签到 连30天
     · ℹ️ 活跃连签 0 属正常：它由成长中心「使用事件（热力墙）」驱动，与积分签到无关
【Qoder】
  ✅ 我的账号: 今日已签到 (+100 Credits)

成功: 2 | 已签: 2 | 失败: 0
```

----------------------------------------

## 🆚 平台对比

| 维度 | TRAE | WorkBuddy | Qoder |
|---|---|---|---|
| 签到接口 | `api.trae.cn/trae/api/v2/ug/checkin_credits/claim` | `www.codebuddy.cn/v2/billing/meter/daily-checkin` | `openapi.qoder.com.cn/sash/api/v1/me/daily-check-in/claim` |
| 认证 | `Cloud-IDE-JWT` + `x-device-id` | `Bearer` + `X-User-Id` | `Bearer {job_token}` |
| Token 刷新 | `ExchangeToken` 简化版（24h 内自动刷新，用 `BoundDeviceID`） | **RT 轮换永续** | PAT → job token 每次自动交换 |
| 凭证来源 | `%APPDATA%/TRAE SOLO CN/`（AES 解密） | 短信登录 / `%LOCALAPPDATA%/CodeBuddyExtension/` | PAT（推荐）或 `%APPDATA%/QoderCN/` |
| 凭证提取 | 仅 Windows | Windows / macOS | 跨平台（PAT）/ 仅 Windows（缓存） |
| QD 模板 | ✅ | ✅（无刷新） | ✅ |

----------------------------------------

## 🧩 Qoder 技术细节

**PAT 模式（推荐，跨平台）**：网站生成 PAT，签到前 `POST /api/v1/jobToken/exchange` 交换短期 job token，无需 DPAPI / SQLite。

**缓存模式（仅 Windows）**：`SharedClientCache/cache/` 下的 `machine_token.json`、`status.json` 为明文；`state.vscdb` 需 Node.js 22+（`node:sqlite`）或 sqlite3 命令行。

**auth-v2.dat 解密（QoderWork 旧版）**：Electron safeStorage 链路 —— `Local State` 的 `os_crypt.encrypted_key` → 去掉 `DPAPI` 头 → Windows DPAPI 解密得 32B 主密钥 → `v10 + nonce(12B) + ciphertext + tag(16B)` → AES-256-GCM。DPAPI 通过 PowerShell `ProtectedData.Unprotect` 调用，必须以**登录用户身份**运行。排查用 `node tools/qodercn-diagnostic.cjs`。

----------------------------------------

## 🔬 接口实测差异（踩坑记录）

以下结论来自参考仓库的真实接口返回，与「看文档猜字段」不同，排错时优先核对这里：

| 平台 | 实测结论 |
|---|---|
| WorkBuddy | 鉴权头必须带 `Bearer ` 前缀（无前缀返回 401）；登录回执是驼峰 `accessToken` / `refreshToken` / `expiresIn`；刷新时 RT **必须放在 `X-Refresh-Token` 请求头**，放 body 会返回 `10001: refreshToken is empty` |
| TRAE | `9074 当前参与用户太多` 是**误导性文案**：上游同账号同时刻对照实测，根因是 `x-device-id` 不被服务端认可（自造号 9074、客户端真实号通过）。设备号是**十进制数字，15/16 位都存在**（合法长度 12~20），UUID / 32 位 hex 必然失败。claim 与 status 的请求体必须带 `req_source`（**IDE=1 / SOLO=2**，须与 token 谱系匹配），空 body 会被拒成 9074。`code=9004/9095` 表示**该设备**今日已签（成功，非错误）；`code=1001` 是鉴权失败，**不能**当成「今日已领取」；`20101` 是 RT 失效或被轮换；刷新返回的 `BoundDeviceID` 优先作为 deviceId |
| Qoder | 无效 PAT 返回 **HTTP 400**（不是 401），错误体 `errorCode: BadRequest`；jobToken 交换同时认 `personal_token` / `personal_access_token`；每日额度轮次约 **10:00（北京时间）** 刷新，claim 幂等 |

----------------------------------------

## ❓ 常见问题 / 排错

**Q：WorkBuddy token 过期了？**
配了 RT 会自动续期，一般无需干预。若报 `token format error` / `12153`，先看日志里的「凭据体检」输出：常见原因是 AT/RT 写反、粘了引号/空格、用了国际版令牌，或 RT 已被其他工具轮换过。最稳妥的做法是重跑 `npm run login:workbuddy`，并删掉 `wb_refresh_tokens.json` 重新建档。

**Q：WorkBuddy 多账号怎么加？会重复签到吗？**
直接再跑一次 `npm run login:workbuddy`（交互式里可以一次性连续加多个手机号），或 `node tools/workbuddy-login.cjs 13900000000`。工具按手机号 **upsert 覆盖**，重复登录同一号码不会新增条目；加载侧还会再按手机号去重一次。`npm run login:list` 查看已保存账号，`npm run login:export` 导出完整多行值给青龙 / Actions，`--remove <手机号>` 删除单个，`--clear` 清空。

**Q：提取工具报「加密信封」？**
WorkBuddy 5.6.2+ 客户端的 AT/RT 是 AES-256-GCM 加密值，密钥不落盘，无法直接读取。改用短信登录工具。

**Q：青龙变量明明配了，却提示未设置？**
定时任务命令必须是 `task checkin.js`，不要填裸 `node checkin.js`。

**Q：Actions 手动跑成功但定时不触发？**
默认分支 → Actions 开关 → Fork 限制 → 60 天无活动 → cron 是 UTC，按此顺序排查（详见上方 Actions 章节）。

**Q：日志里「活跃连签 0 天」是不是签到失败？**
不是。活跃连签由使用事件（热力墙）驱动，与积分签到是两套计数；看「签到连签」判断签到结果。

**Q：Qoder 报「本轮活动未下发」？**
每日额度轮次约 10:00（北京时间）刷新，不是零点。把定时任务改到 `5 10 * * *`（10:05），或设 `QODER_WAIT=5` 让脚本每 60 秒重查一次。claim 接口幂等，当天补跑不会多领。
若**长期**提示未下发，多半是缺 `Cosy-*` 设备头（2026-09-26 起官方要求）：用客户端 `resources/umid/runtime-info.exe --account-stdin` 取 `machineToken / machineCode / machineType`，填 `QODER_MACHINE_*`；官方若改字段名，用 `QODER_EXTRA_HEADERS='{"Cosy-XXX":"yyy"}'` 兜底，无需改代码。

**Q：Qoder 报 `Resource already exists`？**
这是**幂等冲突，表示今天已经领过了**，不是失败。claim 接口用这个文案（或 HTTP 409）表示重复领取，脚本会显示「今日已签到」。若想二次确认，看 `/sash/api/v1/me/daily-check-in/status` 是否 `CLAIMED_TODAY`。

**Q：TRAE 报 `20101` / `refresh token is invalid`？**
该账号的 **RT 已失效**（过期，或被别的程序轮换掉了），AT 也过期时无法签到。处理：重新提取这个账号的凭证 `npm run extract -- --trae`（或先在桌面端重新登录再提取）。
⚠️ **同一个 RT 只能由一个程序轮换**。如果同时挂了别的签到脚本（例如 WorkBuddy-Daily、auto-checkin），两边会互相把对方的 RT 刷失效——这是 `20101` 最常见的真实原因。建议只保留一套。

**Q：TRAE 报 `9074 当前参与用户太多`？**
这句文案有误导性，**几乎总是设备号问题**，不是真的「人多」。按顺序查：
1. 日志有没有 `⚠️ deviceId 不是 12~20 位十进制数字` —— UUID/GUID/自造数字都会被拒；
2. 该 `deviceId` 是否是这个账号在客户端**真实注册过**的号（从别的账号抄来必然 9074）；
3. 是否多账号**共用同一个**设备号 —— 一个真设备号一天只能签一个账号，N 个账号需要 N 个真号；
4. 以上都对才是真限流/高峰，错峰 1~2 小时再跑。

脚本现在**不会**对 9074 做 20s/40s 重试（重试无效，只是浪费 60 秒），会直接告诉你该换设备号。

**Q：某个平台完全没出现在日志里？**
现在启动时会打印两行：`ℹ️ 未配置（跳过）: ...` 与 `🎯 本次执行: ...`。先看这两行——最常见是用了 `--only` 只选了部分平台，或该平台凭证文件/环境变量缺失。
**互动玩法同理**：`WB_GAMES=1` 或 `--games` 才启用，而且只在**签到成功之后**执行；WorkBuddy 未被执行时玩法不会运行。

**Q：多账号会触发风控吗？**
默认账号间隔 3 秒（`WB_GAP` 可调）。TRAE **每个账号必须配独立且真实的 `deviceId`** —— 限额按设备算，一个真设备号一天只能签一个账号，共用或编造都会 9074。成长任务写操作请谨慎开启。

**Q：通知不生效？**
脚本优先加载青龙 `sendNotify`；webhook 渠道需对应环境变量，`NOTIFY=0` 会关闭 webhook（控制台输出和青龙面板通知保留）。

----------------------------------------

## 🔄 从 v1 升级

- 旧环境变量、旧定时任务 `task checkin_all.js`、QD `.har` 模板**全部不用改**
- 想要 WorkBuddy 永续：追加 `WORKBUDDY_REFRESH_TOKEN`，或用提取工具/短信登录补上 `refreshToken` 字段
- 环境变量模板已统一迁到 `env.template/`；建议加 `STATE_DIR` 指向持久目录
- 失败时仍 `exit 1`，青龙可感知并重试

----------------------------------------

## 🧬 设备证明与双端点（2026-11 上游源码核对）

以下实现均对照 `L0NE-6/Trae-AutoCheckin`、`L0NE-6/Qoder-Daily` 源码逐字段核对，不是猜测：

**TRAE 新版续期（20405 Device proof required）**
- 新端点 `https://api.trae.cn/trae/api/v3/oauth/ExchangeToken` 要求带 `DeviceProof`（ECDSA P-256/SHA-256，低 s，base64-DER）与 `DeviceInfo`；签名内容固定为 `POST\n{path}\n{clientId}\n{refreshToken}\n{ts}\n{nonce}`。
- 密钥**必须来自客户端**（storage.json `iCubeAuthInfo://icube-dc:<设备号>` 解密出的 `privateKeyPEM/publicKeyPEM`），自造密钥对会 20403。`npm run extract` 导出的凭证 JSON 已包含这些字段，本地运行零配置。
- 组合链 `(ClientID, PlatformCode)`：IDE → 旧ID/IDE_PC → 旧ID/SOLO_PC，仅 10101/20403 才换下一个。

**Qoder campaigns 双端点探测**
- ① 新体系：`GET /sash/api/v1/me/campaigns` → 筛 `actionType=CLAIM_BENEFIT` + `benefit.kind=CREDITS` 行 → `POST .../campaigns/{id}/claim`（最小鉴权头 + 空 body，避免 503 风控；失败自动换完整设备头重试）。
- ② 兜底：`daily-check-in/status` + `claim` 旧端点。campaigns 不可用 / 无每日行 / 401 时自动回落。
- 设备头字段名（源码核对）：`Cosy-MachineToken / Cosy-MachineCode / Cosy-MachineType / Cosy-MachineOS / Cosy-MachineId / Cosy-MachineHostname`；sash 接口 `Cosy-ClientType=10`、`UA=Qoder`。

**UMID 三件套怎么拿（通常不用抓包）**
- 值由官方组件本地生成：客户端 `resources/umid/runtime-info.exe`，本机装了 Qoder 直接跑 `node tools/qoder-umid.cjs`（国际版加 `--global`），输出可直接粘贴的环境变量。
- 青龙/服务器没装客户端时才需要抓包：mitmproxy 挂代理（`mitmweb -p 8888`），客户端设置代理后登录一次，装 mitmproxy 根证书解 HTTPS，过滤 `openapi.qoder.com.cn` 看 claim 请求头；或直接设 `QODER_EXTRA_HEADERS` 透传任意头。头字段名源码已核对，一般无需抓包。

----------------------------------------

## ⚠️ 免责声明

本项目仅供**学习与个人自动化**使用。签到功能参考自 [trae-check](https://github.com/inlayin/trae-check)、[L0NE-6/Trae-AutoCheckin](https://github.com/L0NE-6/Trae-AutoCheckin)、[wallechfox/Trae-Checkin](https://github.com/wallechfox/Trae-Checkin)、[workbuddy-checkin](https://github.com/LiuKay/workbuddy-checkin)、[L0NE-6/WorkBuddy-Daily](https://github.com/L0NE-6/WorkBuddy-Daily)、[pi-provider-qoder](https://github.com/simonsmh/pi-provider-qoder)、[L0NE-6/Qoder-Daily](https://github.com/L0NE-6/Qoder-Daily) 等开源项目，原始版权归原作者所有。请遵守各平台服务条款，合理使用，风险自负。

----------------------------------------

AI CHECKIN · DAILY SIGNAL ｜ 配好凭证，剩下交给它 ✨
