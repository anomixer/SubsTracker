<<<<<<< HEAD
# SubsTracker - 訂閱管理與提醒系統

基於 Cloudflare Workers 的輕量級訂閱管理系統，幫助你輕鬆跟蹤各類訂閱服務的到期時間，並透過 Telegram、Webhook 等多渠道傳送及時提醒。

> 🎉 專案說明：
> - 原有穩定版本程式碼已保留在 **`legacy-v1`** 分支（可隨時回看/回滾）
> - 從現在開始，**`main` 分支由 AI 託管持續迭代**（功能最佳化、體驗升級、問題修復）
> - 歡迎大家直接試用 `main` 分支，遇到問題就提 Issue —— 我會讓 AI 第一時間跟進修改 👻

![image](https://github.com/user-attachments/assets/22ff1592-7836-4f73-aa13-24e9d43d7064)
=======
# SubsTracker — 订阅管理与提醒系统

基于 Cloudflare Workers 的轻量级订阅管理系统。跟踪所有订阅服务的到期时间，通过 Telegram、Bark、Webhook 等 9 种渠道发送可靠的多档位提醒，并提供完整的发送日志用于自助排查。
>>>>>>> upstream/master

---

## ✨ 功能特色

<<<<<<< HEAD
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
- **Server醬**：支援 Server醬 3 推送
- **PushPlus**：支援 PushPlus 推送

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
=======
### 🎯 订阅管理

- **CRUD**：添加、编辑、删除、启用/停用各类订阅服务
- **多档位提醒**：每订阅独立设置 N 条规则，支持"到期前 7/3/1 天 + 当天 + 到期后每 X 小时重复直到续费"
- **自动续订**：到期后自动推进到期日并写入支付记录
- **手动续订**：自定义金额、日期、周期数、备注
- **支付历史**：完整记录、可编辑/删除（删除时自动回退订阅周期）
- **农历支持**：1900-2100 年农历转换，可按农历周期续订

### 📱 多渠道通知（9 种）

| 渠道 | 状态 | 配置项 |
|------|------|--------|
| Telegram | ✅ MarkdownV2 + 失败降级纯文本 | Bot Token + Chat ID |
| NotifyX | ✅ | API Key |
| Webhook | ✅ 支持自定义 Header 与消息模板 | URL + 模板（含 `{{title}} {{content}} {{daysRemaining}}` 等） |
| 企业微信机器人 | ✅ text/markdown + @ 提醒 | Webhook URL |
| Resend 邮件 | ✅ HTML 模板 | API Key + 收发邮箱 |
| Bark（iOS） | ✅ 支持自建服务器 | Server + Device Key |
| Gotify | ✅ 自托管 | Server URL + App Token |
| Server酱 | ✅ Server酱 3 | SendKey |
| PushPlus | ✅ Topic + Channel | Token |

### 📊 可观测性

- **通知历史页** `/admin/notify-logs`：每条发送（成功 / 失败）都有记录，可按订阅、渠道、状态、时间筛选
- **调度执行日志**：每次 Cron 触发的链路日志（命中/去重/发送/续订计数 + 失败原因），可在通知历史页折叠预览
- **`/debug` 时区诊断**：登录后访问，显示 UTC 时间、用户 TZ 时间、当前是否在通知窗口

### 💰 财务管理

- 多币种（CNY / USD / HKD / TWD / JPY / EUR / GBP / KRW / TRY）+ 动态汇率换算
- 仪表盘：月度/年度支出 + 环比 + 即将到期 + 未来 7 天续费 + 按类型/分类排行

### 🔐 时区与通知时段

- 配置项 `TIMEZONE` 默认 `Asia/Shanghai`，是所有时间判断与展示的真相源
- `NOTIFICATION_HOURS` 是按 `TIMEZONE` 解释的"小时数组"，例如 `["08", "20"]`
- 留空 = 全天可发（仍受 Cron 每小时触发限制）
- `*` 或 `ALL` 等同于留空

---

## 🚀 部署

### 方式一：命令行部署
>>>>>>> upstream/master

```bash
git clone https://github.com/anomixer/SubsTracker.git
cd SubsTracker
<<<<<<< HEAD
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
=======
>>>>>>> upstream/master
npm install

# 设置 Token
# Linux/macOS:
export CLOUDFLARE_API_TOKEN=你的token
# Windows PowerShell:
$env:CLOUDFLARE_API_TOKEN="你的token"

npm run deploy:safe
```

<<<<<<< HEAD
`deploy:safe` 會自動執行：
1. `npm run setup`
   - 檢查是否已有 `SUBSCRIPTIONS_KV` / `SUBSCRIPTIONS_KV_PREVIEW`
   - 若存在則複用原 ID
   - 若不存在則自動建立
   - 自動回寫 `wrangler.toml`
2. `npm run deploy`
   - 執行部署到 Cloudflare Workers
=======
`deploy:safe` 自动执行：
1. `npm run setup` — 检测/创建 `SUBSCRIPTIONS_KV` + `SUBSCRIPTIONS_KV_PREVIEW`，自动写入 `wrangler.toml`
2. `npm run deploy` — `wrangler deploy`
>>>>>>> upstream/master

### 方式二：GitHub Actions 自动部署

Fork 本仓库后，在仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret 名称 | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需要 Workers 编辑 + KV 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID（可选，Token 已锁定账户时可省略） |

配置完成后，每次 push 到 `master` 分支会自动运行测试并部署。也可在 GitHub Actions 页面手动触发 Deploy workflow。

### 默认凭据

部署后首次登录：
- 用户名：`admin`
- 密码：`password`

**首次登录后请立即在系统配置中修改密码。**

### 忘记密码

到 Cloudflare Dashboard → Workers → KV → `SUBSCRIPTIONS_KV` → 编辑 `config` 这条记录的 JSON 中 `ADMIN_PASSWORD` 字段。

---

<<<<<<< HEAD
## 🔄 已部署版本升級（保留原資料）

可以直接升級，且會優先複用原 KV：
=======
## 🔄 升级
>>>>>>> upstream/master

```bash
git pull
npm install
npm run deploy:safe
```

<<<<<<< HEAD
如需備份（可選）：
=======
首次访问时 KV 数据会**自动迁移**到新结构（多 Key 拆分、提醒规则、可观测性日志）。旧数据自动备份保留 7 天。

> ⚠️ **如果你之前按 UTC 配置过 `NOTIFICATION_HOURS`**：升级后该字段改按你设置的 `TIMEZONE` 解释。请到配置页根据底部"实时预览"重新调整。

---

## 🛠 开发
>>>>>>> upstream/master

```bash
npm install
npm test              # 跑 170+ 条单元测试
npm run lint          # tsc 类型检查（用 JSDoc + // @ts-check）
npm run test:watch    # watch 模式

# 本地启动 dev 环境（独立的 miniflare KV，不影响生产数据）
npx wrangler dev --config wrangler.dev.toml --local
# 浏览器打开 http://127.0.0.1:8787，admin/password
```

源码结构：

```
src/
├── index.js              # Worker 入口（fetch + scheduled）
├── app.js                # Hono 应用装配
├── core/                 # 时间 / 农历 / 货币 / 认证
├── data/                 # KV 仓库 + 自动迁移
├── services/             # 调度器 + 通知（9 渠道适配器）
├── api/                  # 路由 + handler + 中间件
└── views/                # HTML 页面（text-import）

public/                   # Workers Assets 静态资源
└── js/lib/               # 共享前端库

tests/                    # Vitest + workers-pool
```

---

<<<<<<< HEAD
## 🔐 首次部署登入說明

部署完成後，訪問你的 Worker 域名：

- 預設使用者名稱：`admin`
- 預設密碼：`password`

首次登入後請立即在系統配置中修改賬號密碼。

## 忘记密码
请前往CloudFlare的KV管理页面,修改KV SUBSCRIPTIONS_KV 下面的config中的内容即可!

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

### Server醬
- **SendKey**：從 [Server醬官網](https://sct.ftqq.com/) 獲取
- 使用 Server醬 3 介面傳送 Markdown 格式通知

### PushPlus
- **Token**：從 [PushPlus 官網](https://www.pushplus.plus/) 獲取
- **Topic**：可選，配置後可傳送到指定群組
- **Channel**：可選，可在系統配置中選擇預設、微信公眾號、郵件、簡訊或 Webhook 渠道

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
=======
## 🔧 第三方 API 通知

```bash
curl -X POST https://your-domain.workers.dev/api/notify/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"title":"自定义标题","content":"消息正文","tags":["可选","标签"]}'
```

也可用 `Authorization: Bearer YOUR_TOKEN` 或 `?token=YOUR_TOKEN`。

---

## 🛠 常见问题
>>>>>>> upstream/master

### "为什么没收到通知？"

1. 登录后访问 `/admin/notify-logs`，按订阅 / 状态 / 时间筛选——若有"failed"行，展开看具体错误
2. 访问 `/debug`，看"时区诊断"区块——确认当前是否在通知窗口
3. 如果"在窗口内但 sched_log status=ok 且 sentCount=0"，说明本次没命中任何提醒规则——检查订阅的"提醒规则"配置

### Authentication error [code: 10000]

通常是 Wrangler 缓存或 Token 权限问题。重新设置 Token 后重试，仍报错则清理 `.wrangler/` 目录后再来。

---

<<<<<<< HEAD
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
=======
## 🤝 贡献 / 协议

PR 欢迎，issue 也欢迎。代码风格：JSDoc 中文注释 + Vitest 单测。
MIT License。

---

## 关注作者

![image](https://github.com/user-attachments/assets/96bae085-4299-4377-9958-9a3a11294efc)

CDN 加速由 Tencent EdgeOne 赞助。
>>>>>>> upstream/master
