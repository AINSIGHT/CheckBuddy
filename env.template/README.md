# 🔧 环境变量模板索引

**需要配置的所有变量都在这个目录下**，按部署场景分成四个文件，挑一个用即可。

| 文件 | 适用场景 | 怎么用 |
|---|---|---|
| [`.env.example`](./.env.example) | 本地 / shell / 自建容器 | `cp .env.example .env` → 编辑 → `source .env` → `npm run checkin` |
| [`qinglong.env`](./qinglong.env) | 青龙面板 | 在「环境变量」逐条添加，或在「配置文件」里导入 |
| [`actions-secrets.md`](./actions-secrets.md) | GitHub Actions | 在 `Settings → Secrets` 里按名称逐个新建 |
| [`qd-variables.md`](./qd-variables.md) | QD（qiandao）框架 | 创建 QD 任务时填模板变量（非环境变量） |

> ⚠️ **脚本只读取 `process.env`，不会自动加载 `.env` 文件。** 本地必须显式 `source`，或用 `set -a; source .env; set +a` / `dotenv` 之类的工具注入。
>
> ✅ 但**本地凭证 JSON 文件会自动加载**（仅本机测试用），见下方「本机凭证文件」。
>
> ⚠️ `.env` 已被 `.gitignore` 屏蔽，模板 `.env.example` 可以提交，但**不要把真实 token 写进任何模板文件**。

## 变量分组速览

| 分组 | 变量 | 必填 |
|---|---|---|
| 账号凭证 | `TRAE_CREDENTIALS` / `WORKBUDDY_CREDENTIALS` / `WORKBUDDY_REFRESH_TOKEN` / `QODER_CREDENTIALS` | 至少一个 |
| WorkBuddy 进阶 | `WB_BASE_URL` `WB_X_DOMAIN` `STATE_DIR` `WB_GAP` `WB_MAKEUP_MAX_PER_RUN` `WB_TASKS` `WB_SKIP_TASKS` `WB_GROWTH_DISCOVER` `WB_GROWTH_WRITE` `WB_ACTIVITY_CONFIRM` | 可选 |
| 互动玩法 | `WB_GAMES` `WB_GAMES_TASKS` `WB_GAMES_SKIP` `WB_GAMES_BASE_URL` `WB_GAMES_MAX_DRAWS` `WB_GAMES_MAX_BLINDBOX` | 可选，默认关闭 |
| Qoder 等待窗口 | `QODER_WAIT` | 可选，默认 `0`（不等待）；轮次未下发时每 60 秒重查 |
| 本地凭证 | `LOCAL_CREDS` | 可选，默认 `1`；置 `0` 关闭本地文件加载 |
| 通知 | `NOTIFY` `BARK_URL` `PUSHPLUS_TOKEN` `WXPUSHER_APP_TOKEN` `WXPUSHER_UID` `SERVERCHAN_SENDKEY` `WECOM_WEBHOOK` `DINGTALK_WEBHOOK` `DINGTALK_SECRET` `QL_CLIENT_ID` `QL_CLIENT_SECRET` `QL_URL` | 可选 |

完整说明与示例见根目录 [README.md](../README.md) 的「🔧 环境变量」「💻 本机测试与本地凭证」与「🌱 WorkBuddy 流程详解」章节。

## 本机凭证文件（每个平台存一份）

本机测试时可以不设环境变量，直接把凭证放在**工作目录**下这些固定文件名里，脚本会在对应环境变量为空时自动加载：

| 文件 | 生成方式 | 对应变量 |
|---|---|---|
| `trae-credentials.json` | `npm run extract` / `npm run save:creds` | `TRAE_CREDENTIALS` |
| `workbuddy-credentials.json` | 同上 | `WORKBUDDY_CREDENTIALS` |
| `qoder-credentials.json` | 同上 | `QODER_CREDENTIALS` |
| `wb_login_result.json` | `npm run login:workbuddy` | `WORKBUDDY_REFRESH_TOKEN`（多账号数组，按手机号去重；优先级最高） |

> 🔒 全部已被 `.gitignore` 屏蔽，0600 权限，日志不打印内容；`LOCAL_CREDS=0` 可关闭。
> 已有 `WORKBUDDY_REFRESH_TOKEN` 时会跳过 `workbuddy-credentials.json`，避免同一账号被加载两次。

## 最小可用配置

```
# 只跑 WorkBuddy，且启用 Token 永续
WORKBUDDY_REFRESH_TOKEN=13800000000:eyJ...:eyJ...
STATE_DIR=/ql/data
```

```
# 三平台全开
TRAE_CREDENTIALS=[{...}]
WORKBUDDY_CREDENTIALS=[{...}]
QODER_CREDENTIALS=[{"pat":"pt-xxxx"}]
```
