# WARP.md

本檔案為 WARP (warp.dev) 在此專案中工作時提供指引。

## 專案概述

SubsTracker 是一個基於 **Cloudflare Workers** 的輕量級訂閱管理系統。它追蹤訂閱到期日期並透過多種渠道發送通知（Telegram、Email、Webhook、企業微信機器人、Bark、NotifyX）。整個應用程式包含在單一的 `index.js` 檔案中（約 5300 行），在 Cloudflare 的邊緣網路上以無伺服器方式執行。

**核心技術：**
- Cloudflare Workers（無伺服器）
- Cloudflare KV（鍵值儲存）
- 原生 JavaScript（無建置工具）
- 以字串模板嵌入的 HTML/CSS/JS

## 開發指令

### 本地開發
本專案不使用 `wrangler dev` 進行本地開發。所有開發和測試都直接在 Cloudflare Workers 上進行。

### 部署
```bash
# 使用 Wrangler CLI 部署到 Cloudflare Workers
wrangler deploy

# 部署到特定環境
wrangler deploy --env production
wrangler deploy --env staging
```

### 查看日誌
```bash
# 查看生產環境日誌
wrangler tail

# 查看特定環境日誌
wrangler tail --env production
```

### 測試
本專案沒有自動化測試。測試透過以下方式手動進行：
1. 訪問 worker URL 的網頁介面
2. 使用 `/debug` 端點進行系統診斷
3. 在設定頁面使用手動通知測試按鈕

### 配置
所有配置都儲存在 Cloudflare KV 中，鍵名為 `config`。無需設定本地環境變數。

## 架構

### 單一檔案架構
整個應用程式都在 `index.js` 中，結構如下：

1. **時區工具函式**（第 1-213 行）：處理多時區的函式（`getCurrentTimeInTimezone`、`formatTimeInTimezone` 等）
2. **農曆系統**（第 215-421 行）：完整的農曆轉換函式庫，包含 1900-2100 年的資料
3. **HTML 模板**（第 423-3489 行）：以字串字面值嵌入的頁面模板（登入、儀表板、設定）
4. **API 處理器**（約第 4000-4477 行）：CRUD 操作的 RESTful API
5. **管理處理器**：身份驗證和受保護的路由
6. **通知系統**（約第 5000-5200 行）：多渠道通知分發
7. **排程任務處理器**（第 5514-5637 行）：基於 Cron 的到期檢查
8. **主要匯出**（第 5693-5773 行）：Cloudflare Workers 進入點，包含 `fetch()` 和 `scheduled()` 處理器

### 關鍵設計模式

**嵌入式前端**：所有 HTML、CSS 和 JavaScript 都以模板字串的形式嵌入在 `index.js` 中。前端 JS 複製了部分後端邏輯（農曆、時區處理），因為沒有共用模組系統。

**KV 儲存架構**：
- `config`：系統配置（管理員憑證、通知設定、時區等）
- `subscriptions`：訂閱物件陣列，包含 `id`、`name`、`expiryDate`、`reminderValue`、`reminderUnit`、`isActive`、`autoRenew`、`category`、`notes`、`useLunar`、`startDate`、`periodValue`、`periodUnit` 等欄位

**身份驗證**：使用 Web Crypto API 的自訂 JWT 實作。JWT 令牌儲存在 cookies 中。

**時區處理**：支援系統級時區（不僅限於 UTC）。`TIMEZONE` 配置值影響所有日期計算和顯示格式。使用 `Intl.DateTimeFormat` API。

**農曆**：訂閱可以基於農曆日期。系統自動計算下次出現時間並在公曆與農曆之間轉換。

### 通知渠道

所有通知渠道由 `sendNotificationToAllChannels()` 處理，分發至：
- Telegram Bot API
- NotifyX API
- 自訂 Webhook（支援模板）
- 企業微信機器人
- Email（透過 Resend API）
- Bark（iOS 推送）

渠道由 `ENABLED_NOTIFIERS` 配置陣列控制。

### 自訂日曆選擇器

前端包含自訂的日曆選擇器（`CustomDatePicker` 類別，約第 2100-2673 行），因為專案避免使用外部相依套件。它支援：
- 月份/年份導航
- 農曆日期顯示
- 日期範圍限制（1900-2100，配合農曆相容性）

### 主題切換

應用程式在所有頁面的右上角包含亮色/暗色主題切換：
- **主題儲存**：使用者偏好儲存在 `localStorage` 中，鍵名為 `theme`（值：`'light'` 或 `'dark'`）
- **圖示邏輯**：亮色模式顯示太陽圖示 ☀️（點擊切換到暗色），暗色模式顯示月亮圖示 🌙（點擊切換到亮色）
- **CSS 方法**：使用 `<body>` 元素上的 `.dark-theme` 類別觸發暗色模式樣式
- **跨頁面同步**：三個頁面（登入、儀表板、設定）在載入時都讀取同一個 localStorage 鍵
- **實作方式**：每個頁面在 `<script>` 區塊末尾都有相同的主題切換 JavaScript，包裝在 IIFE 中
- **色彩系統**：
  - 亮色模式：白色背景、深色文字、hover 時淺靛藍色高亮（`#e0e7ff`）
  - 暗色模式：深灰背景（`#111827`）、淺色文字、hover 時中灰色高亮（`#374151`）
  - 所有顏色類別（如 `text-gray-600`、`text-purple-600`）在暗色模式下自動對應到淺色版本

## 重要實作細節

### 時區計算
訂閱到期檢查使用 `getTimezoneMidnightTimestamp()` 來計算相對於配置時區午夜（而非 UTC 午夜）的「剩餘天數」。這確保提醒在正確的本地時間觸發。

### 自動續訂邏輯
當 `autoRenew` 啟用時，訂閱會根據 `periodValue` 和 `periodUnit`（天/月/年）自動計算下次到期日期。對於基於農曆的訂閱，續訂使用 `lunarBiz.addLunarPeriod()`。

### 排程任務配置
`wrangler.toml` 中的 cron 表達式使用 UTC 時間。`NOTIFICATION_HOURS` 配置允許篩選應發送通知的小時（如果 cron 每小時執行但你只想在特定時間發送通知時很有用）。

### 第三方 API 存取
`/api/notify/{token}` 端點允許外部系統觸發通知。令牌會與配置中的 `THIRD_PARTY_API_TOKEN` 進行驗證。

## 程式碼修改指南

### 新增通知渠道
1. 在 `getConfig()` 函式的預設物件中新增配置欄位
2. 依照現有渠道的模式建立 `send{ChannelName}Notification()` 函式
3. 將渠道加入 `sendNotificationToAllChannels()` 的 switch/if 邏輯中
4. 在設定頁面 HTML 模板字串中新增 UI 欄位
5. 將渠道識別碼加入 `ENABLED_NOTIFIERS` 陣列

### 修改 HTML 模板
HTML 以模板字串的形式嵌入在 JavaScript 中。關鍵模板：
- `loginPage`（約第 424 行）
- `adminPage`（約第 622 行）- 主儀表板，包含訂閱列表
- `configPage`（約第 3265 行）- 系統配置頁面

使用字串串接和模板字面值。注意引號 - 外層字串使用反引號，內層引號要跳脫。

**主題支援**：所有頁面都包含：
- UI 中的主題切換按鈕（登入頁：固定於右上角；其他頁面：在導航列中）
- `.dark-theme` 類別下的暗色主題 CSS 規則
- 與 localStorage 同步的主題切換 JavaScript

### 處理日期
- 始終使用時區感知函式：`getCurrentTimeInTimezone(timezone)`、`formatTimeInTimezone(time, timezone, format)`
- 對於「到期剩餘天數」計算，使用 `getTimezoneMidnightTimestamp()` 確保一致性
- 記住前端複製了時區邏輯 - 可能需要在兩個地方都進行修改

### KV 儲存更新
修改配置架構時：
1. 更新 `getConfig()` 的預設值
2. 更新 API 中的配置儲存處理器
3. 更新前端表單欄位
4. 考慮向後相容性（現有的 KV 資料）

## Cloudflare Workers 特定事項

### 環境繫結
`SUBSCRIPTIONS_KV` 繫結必須在 Cloudflare 儀表板或 `wrangler.toml` 中配置。程式碼會檢查此繫結，如果缺失會在 `/debug` 頁面顯示錯誤。

### Cron 觸發器
`scheduled()` 處理器按照 `wrangler.toml` 中定義的 cron 排程執行。預設為 `"0 8 * * *"`（每天 UTC 08:00）。

要變更通知時間：
1. 調整 `wrangler.toml` 中的 cron 表達式
2. 可選：在設定中配置 `NOTIFICATION_HOURS` 陣列以篩選特定小時

### 回應處理
所有路由都返回帶有適當標頭的 `Response` 物件。API 路由返回 JSON，HTML 路由返回帶 UTF-8 字元集的 text/html。

## 常見陷阱

- **農曆日期**：由於硬編碼的農曆資料，僅對 1900-2100 年有效
- **字串模板**：巢狀引號和模板字面值容易引入語法錯誤
- **前端/後端重複**：農曆和時區邏輯同時存在於伺服器和客戶端程式碼中
- **無建置步驟**：程式碼原樣部署到 Cloudflare。沒有轉譯、打包或壓縮
- **KV 最終一致性**：KV 寫入可能不會立即在所有邊緣位置可見
- **Cron 時間**：記住 cron 使用 UTC，但通知邏輯遵循配置的時區
- **暗色模式文字顏色**：動態生成的 HTML 必須使用 Tailwind 顏色類別（如 `text-gray-700`），以便 CSS 規則自動轉換為暗色模式的淺色

## UI/UX 功能

### 主題切換
- 所有頁面都提供亮色和暗色主題
- 切換按鈕顯示太陽 ☀️（切換到暗色）或月亮 🌙（切換到亮色）
- 偏好設定透過 localStorage 在不同工作階段間保持
- 使用 CSS 動畫（0.3 秒）實現平滑過渡
- 亮色模式使用淺靛藍色 hover 效果，暗色模式使用中灰色 hover 效果
- 所有文字顏色在兩種模式下都確保足夠對比度

### 響應式設計
- 行動優先方法，斷點在 768px 和 1024px
- 表格在行動裝置上折疊為卡片檢視
- 自訂日曆選擇器適應螢幕尺寸

## 檔案結構

```
/
├── index.js           # 整個應用程式（5300+ 行）
├── wrangler.toml      # Cloudflare Workers 配置
├── package.json       # 僅中繼資料，無相依套件
├── README.md          # 使用者文件（中文）
└── WARP.md            # AI 助理的開發指引
```

## 預設憑證

- 使用者名稱：`admin`
- 密碼：`password`

這些憑證儲存在 KV `config` 中，應在首次部署後立即變更。
