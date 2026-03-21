# agent.md

本檔案為 AI 助理在此專案中工作時提供指引。此專案目前由 AI 託管並持續迭代。

## 專案概述

**SubsTracker** 是一個基於 **Cloudflare Workers** 的輕量級訂閱管理系統，追蹤訂閱到期時間並提供多渠道通知（Telegram、Email、Webhook、企業微信機器人、Bark、NotifyX、Gotify）。

專案已升級至 **v2.0.0 模組化架構**，所有代碼均已完成 **繁體中文化 (Traditional Chinese)** 並整合 **財務分析儀表盤** 功能。

**核心技術：**
- **Cloudflare Workers**：Serverless 邊緣計算
- **Cloudflare KV**：分散式鍵值儲存（`config`, `subscriptions`, `payment_history`）
- **Modular JavaScript**：純 JS 模組化開發（無需打包，由 Wrangler 直接部署支援 ES Modules）
- **Tailwind CSS**：前端樣式框架（透過 CDN 引入）
- **OpenCC**：用於進行繁簡體轉換與常用詞彙處理的工具 (`C:\dev\opencc-windows`)

## 檔案結構

```
/
├── src/
│   ├── index.js           # 進入點 (Worker fetch & scheduled handlers)
│   ├── api/               # API 路由與邏輯
│   │   ├── router.js      # API 請求分發
│   │   ├── admin.js       # 管理頁面與頁面渲染
│   │   └── handlers/      # 各模組的 CRUD logic (auth, config, subscriptions, dashboard)
│   ├── core/              # 核心工具庫
│   │   ├── auth.js        # JWT 認證與加密
│   │   ├── time.js        # 時區感知時間處理 (高度重要)
│   │   ├── lunar.js       # 農曆轉換庫 (1900-2100)
│   │   └── currency.js    # 匯率與貨幣處理
│   ├── data/              # KV 數據存取層
│   ├── services/          # 核心服務
│   │   ├── scheduler.js   # 定期檢查排程
│   │   └── notify/        # 各渠道通知發送實作
│   └── views/             # 前端 HTML 模板 (JS 模板字串分離)
│       └── theme-resources.html # 主題系統與浮動切換按鈕
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 專案中繼資料與 Script
├── README.md              # 面向使用者的說明 (繁體)
└── agent.md               # AI 助理開發指南 (本檔案)
```

## 開發與運維指令 (AI 工作流)

### 1) 本地開發與配置同步
專案不再建議修改單一巨型 `index.js`，務必在 `src/` 對應目錄中進行修改。
- **配置同步**：`npm run setup` 會協助從遠端獲取 KV ID 並寫入 `wrangler.toml`。
- **本地預覽**：`npx wrangler dev` (需配置正確環境)。

### 2) 部署
```powershell
# 請確保已設置 $env:CLOUDFLARE_API_TOKEN
npm run deploy:safe    # 包含 setup 與 deploy
```

### 3) 繁體化與 OpenCC (重要)
所有代碼與模板必須保持 **繁體中文** (台灣標準)。
- 工具路徑：`C:\dev\opencc-windows\bin\opencc.exe`
- 配置路徑：`C:\dev\opencc-windows\share\opencc\s2twp.json`
- 指令：`& "C:/dev/opencc-windows/bin/opencc.exe" -c "C:/dev/opencc-windows/share/opencc/s2twp.json" -i input_file -o output_file`

## 重要架構細節

### 時區處理
- **內部計算**：統一使用 **UTC** 處理後端排程和 KV 存儲的時間戳。
- **顯示呈現**：使用 `src/core/time.js` 的工具函數（如 `formatTimeInTimezone`）轉化為用戶配置時區或機器本地時區。
- **重要提醒**：勿使用 Node.js 特有時區 API，應使用 Workers 環境支援的 `Intl.DateTimeFormat`。

### 主題系統 (Dark Mode)
- 基於 `src/views/theme-resources.html`。
- 支援 `html.dark` 類別名進行樣式覆蓋。
- **浮動按鈕**：代碼中加入了一段 IIFE 腳本，會自動在所有頁面右下角插入一個浮動切換按鈕，切換結果持久化於 `localStorage` (鍵名 `themeMode`)。

### 數據字典 (KV)
- `config`：系統層面配置 (密碼, 通知 Token, THEME_MODE)。
- `subscriptions`：用戶訂閱清單。
- `payment_history`：支付記錄 (新 v2.0 功能)。

## 變動指南 (AI 需知)

1. **修改 UI**：修改 `src/views/` 下的 HTML。注意：雖然是 `*.html`，但它們會作為字串導入 `src/views/pages.js`。
2. **新增 API**：在 `src/api/handlers/` 下新增，並在 `src/api/router.js` 註冊。
3. **通知渠道**：在 `src/services/notify/` 新增對應 JS 實作，並在 `index.js` 或 `notify/index.js` 註冊。
4. **提交規範**：每次更新代碼後，請確保 README.md 反映最新功能。保持繁體。

---
*本檔案由 AI 託管。當專案架構發生重大演進時，AI 應主動更新此指南以確保後續開發的一致性。*
