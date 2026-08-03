# 店家核銷 LIFF 掃碼固定流程

本文件是店家核銷工作台的固定流程。後續調整 `/vendor-pos`、廠商登入、LIFF 掃碼、核銷紀錄時，必須先依此檢查，避免再次出現「資料讀得到但相機打不開」或「相機可開但資料卡住」。

## 核心原則

1. 帳密登入是店家後台的主要登入方式。
2. LIFF 只負責 LINE 環境能力，例如掃碼、取得操作者 LINE profile。
3. 店家資料讀取不得被 LIFF login 或 LIFF init 卡住。
4. 在 LINE App 內掃碼，優先使用 `liff.scanCodeV2()`。
5. 一般瀏覽器才使用 `getUserMedia()` 備援。
6. 不要在 POS 初始載入時自動呼叫 `liff.login()`。

## 正確載入順序

1. 從網址或 session 取得 `vendor_id` 與 `portal_token`。
2. 先呼叫 `/api/vendor-pos` 讀取店家資料、折扣設定、今日核銷紀錄。
3. 資料載入成功後，再背景執行 `initVendorIdentity()`。
4. `initVendorIdentity()` 只能補抓操作者 LINE profile，不得阻斷頁面。
5. 若 URL 帶入 QR token，資料載入成功後再執行 QR 檢查。

## 掃碼按鈕流程

按下「開啟 QR 掃描器」時：

1. 呼叫 `ensureLiffReady()` 初始化 LIFF。
2. 若目前在 LIFF client 且支援 `liff.scanCodeV2()`，直接開 LINE 內建掃碼器。
3. 若目前在 LINE App 內但不是 LIFF client，導向 LIFF 版本的同一路徑。
4. 若不是 LINE App，才使用瀏覽器相機 `getUserMedia()`。
5. 若瀏覽器相機被擋，提供拍照或上傳 QR 圖片備援。

## 禁止寫法

1. 禁止在 POS 頁面初始載入時強制 `liff.login()`。
2. 禁止讓 LIFF 初始化失敗造成 `/api/vendor-pos` 不讀取。
3. 禁止用容易被 Worker template literal 破壞的正則判斷 LINE UA。
4. 禁止把 `/Line\//i` 直接放進 Worker HTML 樣板字串。
5. 禁止讓掃碼成功但不寫入核銷紀錄或沒有成功提示。

## LINE UA 判斷固定寫法

使用字串判斷，避免 Worker 樣板輸出後正則變形：

```js
function isLineUserAgent() {
  return String(navigator.userAgent || "").toLowerCase().includes("line/");
}
```

## 必測項目

每次修改後至少檢查：

1. `node --check src/index.js`
2. 部署後抓線上 `/vendor-pos` 實際 HTML，抽出最後一段 `<script>` 執行 `node --check`
3. 確認線上腳本包含：
   - `liff.scanCodeV2`
   - `openSmartScanner`
   - `includes("line/")`
4. 確認線上腳本不包含：
   - `/Line\//i`
   - POS 初始流程中的自動 `liff.login()`
5. LINE 內開啟店家核銷頁，按掃描器可以叫出相機。
6. 掃描母站個人 QR 後，可以顯示會員名稱與歷史消費總計。
7. 輸入原價後，依後台折扣設定產生應收與折抵。
8. 核銷成功後，必須跳出成功提示並播放提示音。

## 常見錯誤對照

| 錯誤 | 原因 | 修法 |
| --- | --- | --- |
| 資料讀取中卡住 | LIFF login/init 阻斷資料載入 | 先 `load()`，再背景補抓 LIFF profile |
| 相機打不開 | LINE 內用到瀏覽器 `getUserMedia()` | 優先使用 `liff.scanCodeV2()` |
| `i is not defined` | `/Line\//i` 在樣板輸出後變形 | 改用 `includes("line/")` |
| 1101 | Worker 或內嵌腳本語法錯 | 本地與線上抽腳本雙重 `node --check` |
| 核銷成功但使用者以為沒成功 | 沒有明確回饋 | 顯示成功彈窗與提示音 |

