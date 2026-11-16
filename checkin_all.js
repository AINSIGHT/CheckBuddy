/**
 * 兼容入口（青龙旧定时任务 `task checkin_all.js` 可继续使用）
 * 实际实现已按平台拆分到 checkin.js + platforms/，本文件只做转发。
 *
 * @cron 5 10 * * *
 */
'use strict'
require('./checkin.js')
