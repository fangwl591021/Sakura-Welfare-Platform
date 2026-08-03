# 櫻花福委會福利資訊整合平台

台灣櫻花福委會的 LINE OA / LIFF 福利平台。系統以 Cloudflare Worker 為入口，整合 D1、R2、LINE Messaging API、LIFF、母站員工驗證與點數服務。

## 核心功能

- LINE 雙 Webhook：母站維持既有會員、員工與點數流程，子站處理福委會功能。
- 員工綁定與 Rich Menu 身分對應：繁中、印尼文、泰文選單。
- 廠商申請、補件、審核、店家資料與優惠管理。
- 店家微官網與 LIFF 核銷工作台。
- 會員消費紀錄、活動日曆、活動報名與 QR 報到。
- LINE OA 聊天室監控、關鍵字規則、分眾推播與 Flex Message。
- 福委會營運、廠商成效與核銷報表。

## 系統邊界

- 母站負責員工名冊驗證、既有會員資料與點數讀寫。
- 子站負責廠商、福利內容、審核、微官網、核銷、活動及營運管理。
- LINE Webhook 必須維持單一回覆責任，避免重複消耗 replyToken。
- Secrets 只存放於 Cloudflare，不得提交到 GitHub。

詳細架構與決策請先閱讀：

- PROJECT_BRIEF.md
- PROJECT_STATUS.md
- ARCHITECTURE.md
- DECISIONS.md
- KNOWN_ISSUES.md
- NEXT_SPRINT.md
- AGENTS.md

## 本機檢查

~~~powershell
cd "D:\OneDrive\文件\New project 5"
npm.cmd ci
npm.cmd run check:welfare
npm.cmd run predeploy:welfare
~~~

## 本機開發

~~~powershell
npm.cmd run dev
~~~

## 部署

部署前必須確認 Worker、D1 與 R2 綁定皆為櫻花福委會環境：

~~~powershell
npm.cmd run deploy:welfare
~~~

等效的明確部署命令為：

~~~powershell
npx.cmd wrangler deploy -c "D:\OneDrive\文件\New project 5\wrangler.sakura-welfare.toml"
~~~

正式 Worker：https://sakura-welfare-platform.fangwl591021.workers.dev/

## 安全規則

- 不提交 .dev.vars、API key、LINE token、Telegram token 或任何帳密。
- D1 migration 與正式部署必須分開確認，不可因推送 GitHub 自動執行。
- 修改 src/index.js 後至少執行 node --check src/index.js。
- 不使用未指定設定檔的裸 wrangler deploy。