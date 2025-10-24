# SubsTracker - 訂閱管理與提醒系統

基於Cloudflare Workers的輕量級訂閱管理系統，幫助您輕鬆跟蹤各類訂閱服務的到期時間，並透過 Telegram、Webhook 等多渠道傳送及時提醒。

![image](https://github.com/user-attachments/assets/22ff1592-7836-4f73-aa13-24e9d43d7064)

## ✨ 功能特色

### 🎯 核心功能
- **訂閱管理**：新增、編輯、刪除各類訂閱服務
- **智慧提醒**：自定義提前提醒天數，自動續訂計算
- **農曆顯示**：支援農曆日期顯示，可控制開關
- **狀態管理**：訂閱啟用/停用，過期狀態自動識別

### 📱 多渠道通知
- **Telegram**：支援 Telegram Bot 通知
- **NotifyX**：整合 NotifyX 推送服務
- **Webhook 通知**：支援自定義 Webhook 推送
- **企業微信機器人**：支援企業微信群機器人通知
- **郵件通知**：基於 Resend 的專業郵件服務
- **Bark**：支援 iOS Bark 推送
- **自定義 Webhook**：支援自定義請求格式和模板

### 🌙 農曆功能
- **農曆轉換**：支援 1900-2100 年農曆轉換
- **智慧顯示**：列表和編輯頁面可控制農曆顯示
- **通知整合**：通知訊息中可包含農曆資訊

### 🎨 使用者體驗
- **響應式設計**：完美適配桌面端和移動端
- **備註最佳化**：長備註自動截斷，懸停顯示完整內容
- **即時預覽**：日期選擇時即時顯示對應農曆
- **使用者偏好**：記住使用者的顯示偏好設定

## 🚀 一鍵部署

### 點選按鈕，一鍵部署到 CloudFlare Workers,

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/anomixer/SubsTracker)


> 適用於新部署的,以前部署過的直接替換js中的內容即可!

## 📋 三步開始使用

### 1️⃣ 一鍵部署
Fork倉庫,然後點選自己倉庫裡的部署按鈕，等待部署完成,**注意,KV名稱修改為 `SUBSCRIPTIONS_KV`**
![image.png](https://img.wangwangit.com/file/1751942578108_image.png)

### 2️⃣ 首次登入
- 訪問部署後的域名
- 預設使用者名稱：`admin`
- 預設密碼：`password`

### 3️⃣ 開始使用
1. **修改預設密碼**（進入系統配置）
2. **配置通知渠道**（選擇一個或多個）
3. **新增訂閱**，設定提醒
4. **享受智慧提醒**！

## 🔧 通知渠道配置

### Telegram
- **Bot Token**: 從 [@BotFather](https://t.me/BotFather) 獲取
- **Chat ID**: 從 [@userinfobot](https://t.me/userinfobot) 獲取

### NotifyX
- **API Key**: 從 [NotifyX官網](https://www.notifyx.cn/) 獲取

### 企業微信機器人
- **推送 URL**: 參考[官方文件](https://developer.work.weixin.qq.com/document/path/91770)獲取

### Webhook 通知
- **推送 URL**: 根據所使用的 Webhook 服務或自建介面填寫，例如 `https://your-service.com/hooks/notify`
- 支援自定義請求方法、請求頭與訊息模板
- **模板佔位符**：`{{title}}`、`{{content}}`、`{{tags}}`（多行形式）、`{{tagsLine}}`、`{{timestamp}}`、`{{formattedMessage}}`

### Bark（iOS 推送）
- **伺服器地址**：預設 `https://api.day.app`，也可使用自建伺服器
- **裝置 Key**：在 Bark App 內複製
- **歷史記錄**：勾選“儲存推送”後可保留推送歷史

### 郵件通知 (Resend)
- **API Key**: 從 [Resend 官方教程](https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/) 獲取
- **發件人郵箱**: 必須是已在 Resend 驗證的域名郵箱
- **收件人郵箱**: 接收通知的郵箱地址
- 支援 HTML 格式的美觀郵件模板

### 🔔 通知時間與時區說明
- Cloudflare Workers 的 Cron 表示式使用 **UTC 時區**，例如 `0 8 * * *` 表示 UTC 08:00 觸發
- 若希望在北京時間（UTC+8）早上 8 點提醒，可將 Cron 設定為 `0 0 * * *`
- 若需要小時級提醒，可將 Cron 調整為 `0 * * * *`（每小時執行一次），並在系統配置中指定允許的通知小時
- 系統配置中的 “系統時區” 用於計算訂閱剩餘時間和格式化展示，建議與提醒需求保持一致

### 🔐 第三方 API 安全呼叫
- 透過 `POST /api/notify/{token}` 可觸發系統通知，請在後臺配置“第三方 API 訪問令牌”
- 令牌也可透過 `Authorization: Bearer <token>` 或 `?token=<token>` 傳入
- 未配置或令牌不匹配時介面會直接拒絕請求，建議定期更換隨機令牌


> 💡 **提示**: 系統預設每天早上8點自動檢查即將到期的訂閱


**歡迎大家關注我的公眾號**

![39d8d5a902fa1eee6cbbbc8a0dcff4b](https://github.com/user-attachments/assets/96bae085-4299-4377-9958-9a3a11294efc)



## 🚀 手動部署指南

### 前提條件

- Cloudflare賬戶
- Telegram Bot (用於傳送通知)
- 可以直接將程式碼丟給AI,幫助查漏補缺

### 部署步驟

1.登陸cloudflare,建立worker,貼上本專案中的js程式碼,點選部署

![image](https://github.com/user-attachments/assets/ff4ac794-01e1-4916-b226-1f4f604dcbd3)


2.建立KV鍵值 **SUBSCRIPTIONS_KV**

![image](https://github.com/user-attachments/assets/c9ebaf3e-6015-4400-bb0a-1a55fd5e14d2)


3.給worker繫結上鍵值對,以及設定定時執行時間!

![image](https://github.com/user-attachments/assets/25b663b3-8e8e-4386-a499-9b6bf12ead76)


4.開啟worker提供的域名地址,輸入預設賬號密碼: admin  password (或者admin admin123),可以在程式碼中檢視預設賬號密碼!

![image](https://github.com/user-attachments/assets/5dac1ce0-43a3-4642-925c-d9cf21076454)


5.前往系統配置,修改賬號密碼,以及配置tg通知的資訊

![image](https://github.com/user-attachments/assets/f6db2089-28a1-439d-9de0-412ee4b2807f)


6.配置完成可以點選測試通知,檢視是否能夠正常通知,然後就可以正常新增訂閱使用了!

![image](https://github.com/user-attachments/assets/af530379-332c-4482-9e6e-229a9e24775e)


## 贊助
本專案 CDN 加速及安全防護由 Tencent EdgeOne 贊助：EdgeOne 提供長期有效的免費套餐，包含不限量的流量和請求，覆蓋中國大陸節點，且無任何超額收費，感興趣的朋友可以點選下面的連結領取

[[Best Asian CDN, Edge, and Secure Solutions - Tencent EdgeOne](https://edgeone.ai/?from=github)]

[![image](https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png)](https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png)

## 🤝 貢獻

歡迎貢獻程式碼、報告問題或提出新功能建議!

## 📜 許可證

MIT License

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=wangwangit/SubsTracker&type=Date)](https://www.star-history.com/#wangwangit/SubsTracker&Date)
