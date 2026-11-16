# ☁️ GitHub Actions · Secrets 清单

在仓库 `Settings → Secrets and variables → Actions` 里点 **New repository secret**，名称填下表左列，值填右列说明。

> 内置工作流：`.github/workflows/checkin.yml`。**公开仓库请勿把令牌当作 Secret 之外的内容提交**；工作流只在私有仓库回写 `wb_refresh_tokens.json`。

## ① 账号凭证（至少一个）

| Secret 名称 | 值 |
|---|---|
| `TRAE_CREDENTIALS` | TRAE 凭证 JSON 数组 |
| `WORKBUDDY_CREDENTIALS` | WorkBuddy 凭证 JSON 数组（旧/新格式均可） |
| `WORKBUDDY_REFRESH_TOKEN` | 推荐，`手机号:AT:RT`，多账号换行分隔 |
| `QODER_CREDENTIALS` | Qoder 凭证 JSON 数组（推荐 PAT） |

## ② WorkBuddy 进阶（可选）

| Secret 名称 | 默认值 | 说明 |
|---|---|---|
| `WB_TASKS` | 空 | 成长任务白名单 |
| `WB_SKIP_TASKS` | 空 | 成长任务黑名单 |
| `WB_ACTIVITY_CONFIRM` | `0` | 活跃事件上报 + 热力图回读 |
| `WB_GROWTH_DISCOVER` | `0` | 成长任务只读发现 |
| `WB_GAP` | `3` | 账号间隔秒数 |
| `WB_GAMES` | `0` | 互动玩法总开关，置 `1` 开启抽奖 / 盲盒 / Buddy 信息 / 猫猫旅行 |
| `WB_GAMES_TASKS` | 空 | 玩法白名单（`lottery,blindbox,buddy_info,travel`） |
| `WB_GAMES_SKIP` | 空 | 玩法黑名单 |
| `QODER_WAIT` | `0` | Qoder 本轮活动未下发时最多等待几分钟（每 60 秒重查，最多 30） |

> `STATE_DIR`、`WB_BASE_URL`、`WB_X_DOMAIN`、`WB_GROWTH_WRITE`、`WB_MAKEUP_MAX_PER_RUN`、`QL_*` 属于容器/本地侧配置，工作流里已固定 `STATE_DIR=${{ github.workspace }}/state`，其余可按需在 `checkin.yml` 的 `env:` 段补充。

## ③ 通知（可选）

| Secret 名称 | 渠道 |
|---|---|
| `NOTIFY` | 推送策略：`always` / `fail` / `0` |
| `BARK_URL` | Bark |
| `PUSHPLUS_TOKEN` | PushPlus |
| `WXPUSHER_APP_TOKEN` + `WXPUSHER_UID` | WxPusher |
| `SERVERCHAN_SENDKEY` | Server酱 |
| `WECOM_WEBHOOK` | 企业微信机器人 |
| `DINGTALK_WEBHOOK` + `DINGTALK_SECRET` | 钉钉机器人（加签） |

## ⚠️ 定时不触发排查

1. 默认分支必须是 `main`（schedule 只在默认分支生效）
2. `Settings → Actions → General` 确认允许 Actions，并在 Actions 页启用 workflow
3. Fork 仓库默认禁用定时，需要手动启用；**想要「私有仓库 + 令牌持久化」请用 Import 或手动上传，不要用 Fork**
4. 60 天无活动会被 GitHub 自动停用 schedule，手动跑一次或 push 一下可重新激活
5. cron 是 UTC：工作流里 `5 2 * * *` = 北京时间 10:05，`37 15 * * *` = 23:37
6. schedule 是 best-effort，高峰期可能延迟或跳过；需要精确时间请用 `workflow_dispatch`
