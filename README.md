# SubsTracker — 訂閱管理与提醒系统

基於 Cloudflare Workers 的輕量級訂閱管理系統。追蹤所有訂閱服务的到期时间，透過 Telegram、Bark、Webhook 等 9 种管道发送可靠的多檔位提醒，并提供完整的发送日志用于自助排查。

---

## ✨ 功能特色

### 🎯 訂閱管理

- **CRUD**：添加、編輯、刪除、启用/停用各类訂閱服务
- **多檔位提醒**：每訂閱独立設定 N 条规则，支持"到期前 7/3/1 天 + 當天 + 到期後每 X 小時重複直到續費"
- **自動續訂**：到期後自动推進到期日并寫入支付記錄
- **手動續訂**：自定義金額、日期、週期數、備註
- **支付歷史**：完整記錄、可編輯/刪除（刪除时自动回退訂閱週期）
- **農曆支援**：1900-2100 年農曆轉換，可按農曆週期续订

### 📱 多管道通知（9 种）

| 管道 | 狀態 | 配置項 |
|------|------|--------|
| Telegram | ✅ MarkdownV2 + 失敗降級純文字 | Bot Token + Chat ID |
| NotifyX | ✅ | API Key |
| Webhook | ✅ 支持自定義 Header 与消息模板 | URL + 模板（含 `{{title}} {{content}} {{daysRemaining}}` 等） |
| 企业微信机器人 | ✅ text/markdown + @ 提醒 | Webhook URL |
| Resend 郵件 | ✅ HTML 模板 | API Key + 收发邮箱 |
| Bark（iOS） | ✅ 支持自建伺服器 | Server + Device Key |
| Gotify | ✅ 自託管 | Server URL + App Token |
| Server酱 | ✅ Server酱 3 | SendKey |
| PushPlus | ✅ Topic + Channel | Token |

### 📊 可觀測性

- **通知歷史頁** `/admin/notify-logs`：每条发送（成功 / 失敗）都有記錄，可按訂閱、管道、狀態、时间篩選
- **排程執行日志**：每次 Cron 觸發的鏈路日志（命中/去重/发送/续订計數 + 失敗原因），可在通知歷史頁摺疊預覽
- **`/debug` 時區診斷**：登录后访问，显示 UTC 时间、用户 TZ 时间、當前是否在通知窗口

### 💰 財務管理

- 多幣種（CNY / USD / HKD / TWD / JPY / EUR / GBP / KRW / TRY）+ 动态匯率換算
- 儀表板：月度/年度支出 + 環比 + 即將到期 + 未來 7 天續費 + 按類型/分类排行

### 🔐 時區与通知时段

- 配置項 `TIMEZONE` 預設 `Asia/Shanghai`，是所有时间判断与展示的真相源
- `NOTIFICATION_HOURS` 是按 `TIMEZONE` 解释的"小時陣列"，例如 `["08", "20"]`
- 留空 = 全天可发（仍受 Cron 每小時觸發限制）
- `*` 或 `ALL` 等同于留空

---

## 🚀 部署

### 方式一：命令行部署

```bash
git clone https://github.com/wangwangit/SubsTracker.git
cd SubsTracker
npm install

# 設定 Token
# Linux/macOS:
export CLOUDFLARE_API_TOKEN=你的token
# Windows PowerShell:
$env:CLOUDFLARE_API_TOKEN="你的token"

npm run deploy:safe
```

`deploy:safe` 自動執行：
1. `npm run setup` — 偵測/建立 `SUBSCRIPTIONS_KV` + `SUBSCRIPTIONS_KV_PREVIEW`，自动寫入 `wrangler.toml`
2. `npm run deploy` — `wrangler deploy`

### 方式二：GitHub Actions 自動自動部署

Fork 本仓库后，在仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret 名称 | 說明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需要 Workers 編輯 + KV 編輯权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID（可选，Token 已鎖定帳戶时可省略） |

配置完成后，每次 push 到 `master` 分支会自动執行測試并部署。也可在 GitHub Actions 页面手动觸發 Deploy workflow。

### 預設憑證

部署后首次登录：
- 使用者名稱：`admin`
- 密碼：`password`

**首次登录后请立即在系统配置中修改密碼。**

### 忘記密碼

到 Cloudflare Dashboard → Workers → KV → `SUBSCRIPTIONS_KV` → 編輯 `config` 这条記錄的 JSON 中 `ADMIN_PASSWORD` 字段。

---

## 🔄 升級

```bash
git pull
npm install
npm run deploy:safe
```

首次访问时 KV 數據会**自動遷移**到新結構（多 Key 拆分、提醒规则、可觀測性日志）。旧數據自动備份保留 7 天。

> ⚠️ **如果你之前按 UTC 配置过 `NOTIFICATION_HOURS`**：升級后该字段改按你設定的 `TIMEZONE` 解释。请到配置页根据底部"实时預覽"重新調整。

---

## 🛠 開發

```bash
npm install
npm test              # 跑 170+ 条单元測試
npm run lint          # tsc 類型检查（用 JSDoc + // @ts-check）
npm run test:watch    # watch 模式

# 本地启动 dev 环境（独立的 miniflare KV，不影响生产數據）
npx wrangler dev --config wrangler.dev.toml --local
# 浏览器打开 http://127.0.0.1:8787，admin/password
```

源码結構：

```
src/
├── index.js              # Worker 入口（fetch + scheduled）
├── app.js                # Hono 应用装配
├── core/                 # 时间 / 農曆 / 货币 / 认证
├── data/                 # KV 仓库 + 自動遷移
├── services/             # 排程器 + 通知（9 管道适配器）
├── api/                  # 路由 + handler + 中间件
└── views/                # HTML 页面（text-import）

public/                   # Workers Assets 静态资源
└── js/lib/               # 共享前端库

tests/                    # Vitest + workers-pool
```

---

## 🔧 第三方 API 通知

```bash
curl -X POST https://your-domain.workers.dev/api/notify/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"title":"自定義标题","content":"消息正文","tags":["可选","标签"]}'
```

也可用 `Authorization: Bearer YOUR_TOKEN` 或 `?token=YOUR_TOKEN`。

---

## 🛠 常見問題

### "为什么沒收到通知？"

1. 登录后访问 `/admin/notify-logs`，按訂閱 / 狀態 / 时间篩選——若有"failed"行，展开看具体错误
2. 访问 `/debug`，看"時區診斷"区块——确认當前是否在通知窗口
3. 如果"在窗口内但 sched_log status=ok 且 sentCount=0"，說明本次没命中任何提醒规则——检查訂閱的"提醒规则"配置

### Authentication error [code: 10000]

通常是 Wrangler 缓存或 Token 权限问题。重新設定 Token 后重试，仍报错则清理 `.wrangler/` 目录后再来。

---

## 🤝 貢獻 / 協議

PR 欢迎，issue 也欢迎。程式碼風格：JSDoc 中文註解 + Vitest 单测。
MIT License。

---

## 關注作者

![image](https://github.com/user-attachments/assets/96bae085-4299-4377-9958-9a3a11294efc)

CDN 加速由 Tencent EdgeOne 贊助。
