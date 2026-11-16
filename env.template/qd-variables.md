# 📋 QD（qiandao）框架 · 模板变量清单

QD 用的是**模板变量**（不是环境变量），在 QD 面板创建任务时逐项填写。模板文件位于 `qd-templates/`。

> ⚠️ QD 不支持 token 自动刷新：TRAE / Qoder 的短期令牌需定期用提取工具更新变量；WorkBuddy 建议改用青龙或 GitHub Actions 以启用 RT 续期。

## TRAE（`qd-templates/trae_checkin.har`）

| 变量名 | 说明 |
|---|---|
| `trae_host` | API 域名，如 `https://api.trae.cn` |
| `trae_token` | JWT token |
| `trae_device_id` | 设备 ID |
| `trae_user_id` | 用户 ID |

## WorkBuddy（`qd-templates/workbuddy_checkin.har`）

| 变量名 | 说明 |
|---|---|
| `wb_token` | Bearer token（AT） |
| `wb_uid` | 用户 ID |
| `wb_enterprise_id` | 企业 ID（可选） |
| `wb_domain` | 域（可选） |

## Qoder（`qd-templates/qoder_checkin.har`）

| 变量名 | 说明 |
|---|---|
| `qoder_token` | Bearer token（job token） |

## 定时示例

`0 8 * * *`（每天 08:00）
