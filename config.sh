## ==========================================================================
## 青龙面板环境变量配置模板
## ==========================================================================
## 使用方法：
##   1. 在 Windows 电脑上运行 `node tools/extract-all-credentials.cjs` 提取凭证
##   2. 将输出的 JSON 复制到青龙面板「环境变量」中
##   3. 三个变量全部可选，配了哪个就签哪个
## ==========================================================================

## TRAE 签到凭证
## 获取方式: node tools/extract-all-credentials.cjs --trae
## 多账号: 切换 TRAE 桌面端账号后重跑提取，合并为 JSON 数组
export TRAE_CREDENTIALS=''

## WorkBuddy 签到凭证
## 获取方式: node tools/extract-all-credentials.cjs --workbuddy
## 多账号: 切换客户端账号后重跑提取，合并为 JSON 数组
export WORKBUDDY_CREDENTIALS=''

## Qoder 签到凭证（推荐 PAT 模式）
## 获取方式:
##   PAT 模式（推荐）: node tools/extract-all-credentials.cjs --qoder-pat=pt-xxxx
##   获取 PAT: 登录 https://qoder.com.cn → 设置 → API Keys → 新建
##   缓存模式: node tools/extract-all-credentials.cjs --qoder
export QODER_CREDENTIALS=''
