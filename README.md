# SubsTracker - 訂閱管理與提醒系統

基於 Cloudflare Workers 的輕量級訂閱管理系統，幫助你輕鬆跟蹤各類訂閱服務的到期時間，並透過 Telegram、Webhook 等多渠道傳送及時提醒。

> 🎉 專案說明：
> - 原有穩定版本程式碼已保留在 **`legacy-v1`** 分支（可隨時回看/回滾）
> - 從現在開始，**`main` 分支由 AI 託管持續迭代**（功能最佳化、體驗升級、問題修復）
> - 歡迎大家直接試用 `main` 分支，遇到問題就提 Issue —— 我會讓 AI 第一時間跟進修改 👻

![image](https://github.com/user-attachments/assets/22ff1592-7836-4f73-aa13-24e9d43d7064)

---

## ✨ 功能特色

### 🎯 核心功能
- **訂閱管理**：新增、編輯、刪除各類訂閱服務
- **智慧提醒**：自定義提前提醒天數，自動續訂計算
- **農曆顯示**：支援農曆日期顯示，可控制開關
- **狀態管理**：訂閱啟用/停用，過期狀態自動識別
- **財務追蹤**：記錄訂閱費用，完整的支付歷史和統計分析
- **手動續訂**：支援自定義金額、週期和備註
- **儀表盤**：視覺化展示月度/年度支出，支出趨勢和分類統計

### 📱 多渠道通知
- **Telegram**：支援 Telegram Bot 通知
- **NotifyX**：整合 NotifyX 推送服務
- **Webhook 通知**：支援自定義 Webhook 推送
- **企業微信機器人**：支援企業微信群機器人通知
- **郵件通知**：基於 Resend 的郵件服務
- **Bark**：支援 iOS Bark 推送

### 🌙 農曆功能
- **農曆轉換**：支援 1900-2100 年農曆轉換
- **智慧顯示**：列表和編輯頁面可控制農曆顯示
- **通知整合**：通知訊息中可包含農曆資訊

### 🎨 使用者體驗
- **響應式設計**：適配桌面端和移動端
- **備註最佳化**：長備註自動截斷，懸停顯示完整內容
- **即時預覽**：日期選擇時即時顯示對應農曆
- **外觀風格**：支援淺色模式、深色模式、跟隨系統

### 💰 財務管理
- **訂閱金額追蹤**：支援多幣種記錄
- **匯率換算**：支援動態匯率、固定匯率
- **智慧儀表盤**：
  - 📊 月度/年度支出統計，環比趨勢分析
  - 💳 活躍訂閱數量，月均支出計算
  - 📅 最近7天支付記錄，即將續費提醒
  - 📈 按型別/分類的支出排行和佔比
- **支付歷史管理**：
  - 📝 完整支付記錄，支援編輯/刪除
  - 🕒 精確顯示計費週期
  - 📊 累計支出和支付次數統計
  - 🔄 刪除支付記錄時自動回退訂閱週期
- **高階續訂功能**：
  - 💵 自定義續訂金額
  - 📅 選擇續訂日期（支援回溯）
  - 🔢 批次續訂多個週期
  - 📝 新增續訂備註
  - 👁️ 即時預覽新的到期日期

---

## 🧰 環境準備

### 1) 下載專案到本地（必須）

本專案採用 Wrangler 本地部署模式，不是 Cloudflare Dashboard 直接連線 GitHub 自動部署。
請先將專案下載到本地：

```bash
git clone https://github.com/anomixer/SubsTracker.git
cd SubsTracker
```

> ⚠️ 必須進入包含 **package.json** 的專案目錄後才能執行之後的 **npm install**。

### 2) 安裝 Node.js / npm

如果你電腦裡沒有 `npm`：

- 前往官網下載安裝：<https://nodejs.org/>
- 推薦安裝 LTS 版本（安裝後自動包含 npm）

安裝後驗證：

```bash
node -v
npm -v
```

### 3) 獲取 Cloudflare API Token

1. 開啟 Cloudflare Dashboard → **My Profile** → **API Tokens**
2. 點選 **Create Token**
3. **強烈推薦**使用 Edit Cloudflare Workers 模版（Edit Cloudflare Workers）
4. 許可權至少包含：
   - Workers Scripts: Edit
   - Workers KV Storage: Edit
5. Account Resources 選擇你的目標賬號
6. 建立後複製 Token

![image-20260227170420115](https://img.996007.icu/file/1772183075773_20260227170427274.png)

> ⚠️ Token 只顯示一次，請妥善儲存；洩露後請立刻刪除重建。

---

## 🚀 部署方式（推薦）

```bash
npm install
# Windows PowerShell:
$env:CLOUDFLARE_API_TOKEN="你的token"
npm run deploy:safe
```

`deploy:safe` 會自動執行：
1. `npm run setup`
   - 檢查是否已有 `SUBSCRIPTIONS_KV` / `SUBSCRIPTIONS_KV_PREVIEW`
   - 若存在則複用原 ID
   - 若不存在則自動建立
   - 自動回寫 `wrangler.toml`
2. `npm run deploy`
   - 執行部署到 Cloudflare Workers

![image-20260227170513582](https://img.996007.icu/file/1772183123590_20260227170513797.png)

如果你是 Windows CMD：

```bat
set CLOUDFLARE_API_TOKEN=你的token
npm run deploy:safe
```

---

## 🔄 已部署版本升級（保留原資料）

可以直接升級，且會優先複用原 KV：

```bash
git pull
npm install
# Windows PowerShell:
$env:CLOUDFLARE_API_TOKEN="你的token"
npm run deploy:safe
```

如需備份（可選）：

```bash
npx wrangler kv key get --binding=SUBSCRIPTIONS_KV --env="" --remote config > backup-config.json
npx wrangler kv key get --binding=SUBSCRIPTIONS_KV --env="" --remote subscriptions > backup-subscriptions.json
```

---

## 🔐 首次部署登入說明

部署完成後，訪問你的 Worker 域名：

- 預設使用者名稱：`admin`
- 預設密碼：`password`

首次登入後請立即在系統配置中修改賬號密碼。

---

## 🔧 通知渠道配置

### Telegram
- **Bot Token**: 從 [@BotFather](https://t.me/BotFather) 獲取
- **Chat ID**: 從 [@userinfobot](https://t.me/userinfobot) 獲取

### NotifyX
- **API Key**: 從 [NotifyX 官網](https://www.notifyx.cn/) 獲取

### 企業微信機器人
- **推送 URL**: 參考 [官方文件](https://developer.work.weixin.qq.com/document/path/91770) 獲取

### Webhook 通知
- **推送 URL**: 例如 `https://your-service.com/hooks/notify`
- 支援自定義請求方法、請求頭與訊息模板
- **模板佔位符**：`{{title}}`、`{{content}}`、`{{tags}}`、`{{tagsLine}}`、`{{timestamp}}`、`{{formattedMessage}}`

### Bark（iOS 推送）
- **伺服器地址**：預設 `https://api.day.app`，也可用自建伺服器
- **裝置 Key**：在 Bark App 內複製
- **歷史記錄**：勾選“儲存推送”後可保留推送歷史

### 郵件通知 (Resend)
- **API Key**: 從 [Resend 官方教程](https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/) 獲取
- **發件人郵箱**: 需為 Resend 已驗證域名郵箱
- **收件人郵箱**: 接收通知的郵箱

### 🔔 通知時間與時區說明
- 後端排程與計算統一使用 **UTC**
- `notificationHours` 按 **UTC 小時**解釋
- 留空表示全天允許傳送
- 前端頁面時間按“當前裝置時區”顯示

### 🔐 第三方 API 安全呼叫
- `POST /api/notify/{token}` 可觸發系統通知
- 令牌也支援 `Authorization: Bearer <token>` 或 `?token=<token>`
- 未配置或令牌不匹配時介面會拒絕請求

---

## 🛠 常見問題排查

### `Authentication error [code: 10000]`
通常是本地 Wrangler 狀態/快取或 Token 許可權問題。

可按順序處理：

```bash
# PowerShell 重新設定 token
$env:CLOUDFLARE_API_TOKEN="你的token"
npm run deploy:safe
```

若仍報錯，清理本地 Wrangler 快取後重試：

- Windows: `C:\Users\<你的使用者名稱>\AppData\Roaming\xdg.config\.wrangler\`

刪除目錄後，重新設定 token 再執行部署。

---

## 歡迎關注我的公眾號

![39d8d5a902fa1eee6cbbbc8a0dcff4b](https://github.com/user-attachments/assets/96bae085-4299-4377-9958-9a3a11294efc)

---

## 贊助

本專案 CDN 加速及安全防護由 Tencent EdgeOne 贊助：EdgeOne 提供長期有效的免費套餐，包含不限量流量和請求，覆蓋中國大陸節點，且無超額收費。

[[Best Asian CDN, Edge, and Secure Solutions - Tencent EdgeOne](https://edgeone.ai/?from=github)]

[![image](https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png)](https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png)

---

## 🤝 貢獻

歡迎貢獻程式碼、報告問題或提出新功能建議。

## 📜 許可證

MIT License

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=wangwangit/SubsTracker&type=Date)](https://www.star-history.com/#wangwangit/SubsTracker&Date)
