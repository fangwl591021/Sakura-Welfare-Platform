# DEPLOYMENT

## 正式部署目標

```text
Worker: sakura-welfare-platform
D1: sakura-welfare-db
R2: sakurakitchen-files
Config: wrangler.sakura-welfare.toml
```

## GitHub Actions 手動部署

在 GitHub Actions 選擇 **Deploy Sakura Welfare**，點選 **Run workflow**。預設 `isolated` 會執行完整部署前檢查與冒煙測試，使用假資料演練版本上傳、啟用與部署後核對，這個模式不會取得正式憑證。

正式發布時，從 `main` 手動選擇 `production`。工作流程把冒煙測試通過的同一份打包檔交給 `production` 環境。上傳 Worker 後先核對版本設定與綁定，再切換流量。切換後執行 `verify:welfare` 唯讀核對，失敗會使工作流程回報失敗。GitHub 推送和 PR 仍只執行驗證。

正式環境沿用 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` GitHub secrets。若有獨立的 `CLOUDFLARE_READ_API_TOKEN`，部署後核對會優先使用它。部署步驟不執行 D1 migrations。

## 禁止使用

```powershell
npx.cmd wrangler deploy
```

未指定設定檔時會使用預設 `wrangler.toml`，可能誤部署到 `sakuragroup`。

## 部署前檢查

```powershell
git status --short
node --check "src\index.js"
npm.cmd run predeploy:welfare
```

## 本機冒煙測試

在此專案目錄以 Node.js 24 執行。首次使用先照鎖檔安裝依賴。

```powershell
npm.cmd ci
npm.cmd run test:welfare:smoke
```

指令先用 Wrangler dry-run 打包至本機暫存目錄，再對打包結果與隔離資料執行測試。範圍包括商城商品單價、購買申請總額與員工權限、推播受眾的預覽和逐人略過、廠商多品牌權限與雙身分 QR 入口，以及部署核對指令的模擬測試。瀏覽器測試使用已安裝的 Playwright Chromium，沒有安裝時使用 Chrome。也可用 `npm.cmd exec -- playwright install chromium` 安裝對應版本。

此指令會從測試程序移除正式服務的環境憑證。商城申請、LINE 與 Telegram 回應均使用隔離資料或模擬服務。正式發版仍須執行完整的 `predeploy:welfare`。

## 部署後唯讀核對

手動部署流程會自動執行此核對。單獨執行時，使用本次上傳的原始候選打包檔 `index.js`、新舊版本 ID，以及 `CLOUDFLARE_ACCOUNT_ID` 和具 Workers Scripts Read 權限的 `CLOUDFLARE_API_TOKEN` 環境變數。

```powershell
npm.cmd run verify:welfare -- --bundle ".wrangler/welfare-candidate/index.js" --version 新版本ID --previous-version 前版ID
```

指令只發送 GET，核對正式流量版本、打包檔 SHA-256、前後版本綁定及執行設定、預定排程、五個相關頁面與五個未登入存取限制。任一項不符即回傳失敗，並指明是哪項檢查。適用於預期保留既有綁定與排程的程式發版。
