# 廠商專區與 POS 登入狀態防呆文件

本文件記錄 2026-07 廠商專區、廠商登入、POS 核銷工作台多次出錯的原因與固定修法。後續凡是修改以下功能，必須先讀本文件：

- LINE OA 關鍵字 `廠商專區`
- 廠商帳密登入 `/vendor-login`
- 廠商操作中心 `/vendor-portal`
- 店家核銷工作台 `/vendor-pos`
- LIFF 掃碼與 POS 核銷
- Vendor Flex Carousel 的按鈕連結

## 一、這幾次實際踩到的錯誤

### 1. LINE 內進 POS 每次都要求重新登入

現象：

- 從 LINE 聊天室點 `廠商專區`。
- 點 `核銷工作台`。
- 已經登入過，仍然被要求重新輸入帳密。
- 昨天有效，隔天又失效。

根因：

- LINE WebView 對 cookie / localStorage / sessionStorage 的保存不穩定。
- 舊設計讓 `核銷工作台` 先走 `/vendor-portal?...&next=pos`，再期待頁面用 cookie 或 storage 轉入 `/vendor-pos`。
- 這條路徑在 LINE 內容易因快取、WebView 狀態、舊卡片 URL 或 storage 遺失而失敗。

固定修法：

- `廠商專區` 產出的 Flex Carousel 中，`核銷工作台` 必須直接帶 `vendor_id + portal_token` 進 `/vendor-pos`。
- 不要只依賴 `/vendor-portal?...&next=pos`。
- `/vendor-pos`、`/vendor-login`、`/vendor-portal` 必須加 `Cache-Control: no-store, no-cache, must-revalidate`。

目前正確入口：

```text
https://liff.line.me/{LIFF_ID}/vendor-pos?vendor_id={vendor_id}&portal_token={portal_token}
```

備援入口：

```text
https://liff.line.me/{LIFF_ID}/vendor-portal?vendor_id={vendor_id}&uid={line_uid}&sig={sig}&next=pos
```

只有在沒有 vendor portal username、無法產 token 時，才使用備援入口。

## 二、不能再犯的修改方式

### 禁止 1：把 POS 入口改回只靠 cookie

錯誤寫法：

```js
const posUrl = liffLink('/vendor-portal?' + baseParams + '&next=pos');
```

這會讓 LINE WebView 再次回到不穩定狀態。

正確寫法概念：

```js
const portalUsername = String(vendor && vendor.vendor_portal_username ? vendor.vendor_portal_username : '').trim();
const portalToken = portalUsername ? await createVendorPortalToken(env, vendorId, portalUsername) : '';
const posUrl = portalToken
  ? liffLink('/vendor-pos?vendor_id=' + encodeURIComponent(vendorId) + '&portal_token=' + encodeURIComponent(portalToken))
  : liffLink('/vendor-portal?' + baseParams + '&next=pos');
```

### 禁止 2：POS 頁面初始載入時自動呼叫 `liff.login()`

POS 的主登入模式是帳密。LIFF 只負責 scanner/profile 能力。

正確順序：

1. 從 URL 或 cookie/session 取得 `vendor_id` 與 `portal_token`。
2. 先呼叫 `/api/vendor-pos` 讀店家資料。
3. 資料成功後才背景初始化 LIFF profile 或 scanner 能力。
4. 掃碼按鈕被按下時才進入 LIFF scanner 判斷。

### 禁止 3：把廠商公開微官網與廠商工作台混在一起

- `/vendor-store` 是公開展示頁。
- `/vendor-pos` 是核銷工作台，必須授權。
- 公開店家頁不要放任何讓一般消費者誤入的廠商登入按鈕。
- `廠商登入` 應透過 LINE 關鍵字或明確後台入口提供。

### 禁止 4：改動後只看本機，不看 LINE 新卡片

LINE 聊天室舊 Flex 卡片不會自動更新。

每次修 `廠商專區` Flex 按鈕後，測試時必須：

1. 在 LINE 重新輸入 `廠商專區`。
2. 使用新產生的 Flex 卡片。
3. 不要拿舊卡片測試。

## 三、正確責任邊界

### Vendor account/password

用途：

- 廠商主登入方式。
- 大廠由系統代建帳號時也能使用。
- 不要求廠商一定用個人 LINE 註冊或登入。

### LIFF

用途：

- LINE 內開啟 POS。
- 掃碼相機 `liff.scanCodeV2()`。
- 需要 LINE profile 時補抓操作者資訊。

限制：

- 不應成為 POS 頁面資料載入的前置條件。
- 不應在 POS 初始載入時強迫登入。

### Portal token

用途：

- 讓已通過綁定與核准的廠商，從 LINE `廠商專區` 直接進 POS。
- 避免 LINE WebView cookie/storage 不穩造成反覆登入。

注意：

- token 目前由 `createVendorPortalToken` 產生。
- token 有效期目前為 7 天。
- 舊 LINE 卡片中的 token 過期後，重新輸入 `廠商專區` 產生新卡片即可。

## 四、相關程式位置

主要檔案：

```text
D:\OneDrive\文件\New project 5\src\index.js
```

重要函式與路由：

```text
createVendorPortalToken
verifyVendorPortalToken
vendorPortalSetCookie
applyVendorPortalCookieToUrl
buildVendorPortalFlex
findVisibleVendorByLineUserId
renderVendorPosHtml
handleVendorPortalLogin
GET /vendor-login
GET /vendor-portal
GET /vendor-pos
GET /api/vendor-pos
POST /api/vendor-login
POST /api/vendor-pos/redeem
```

目前已確認的關鍵修正：

- `buildVendorPortalFlex` 中 `核銷工作台` 優先產生 `/vendor-pos?vendor_id=...&portal_token=...`。
- `/vendor-pos` GET 回應加 `Cache-Control: no-store, no-cache, must-revalidate`。
- `/vendor-login` GET 回應加 `Cache-Control: no-store, no-cache, must-revalidate`。
- `/vendor-portal` GET 回應加 `Cache-Control: no-store, no-cache, must-revalidate`。

## 五、修改前檢查清單

修改廠商登入、廠商專區或 POS 前，先確認：

- 是否會動到 `buildVendorPortalFlex`。
- 是否會動到 `/vendor-pos` 初始載入順序。
- 是否會動到 `portal_token` 驗證。
- 是否會讓 `/vendor-store` 公開頁出現廠商登入或工作台入口。
- 是否會把 LIFF login 放到 POS 資料載入之前。
- 是否會把母站、子站、LINE Login callback 混在一起。

## 六、修改後必測清單

### 本地語法

```powershell
cd "D:\OneDrive\文件\New project 5"
node --check src\index.js
npm.cmd run predeploy:welfare
```

### 部署

```powershell
cd "D:\OneDrive\文件\New project 5"
npx.cmd wrangler deploy -c wrangler.sakura-welfare.toml
```

禁止使用：

```powershell
npx.cmd wrangler deploy
```

### 線上快取檢查

```powershell
cd "D:\OneDrive\文件\New project 5"
curl.exe -sS -D - -o NUL "https://sakura-welfare-platform.fangwl591021.workers.dev/vendor-pos"
```

必須看到：

```text
HTTP/1.1 200 OK
Cache-Control: no-store, no-cache, must-revalidate
```

### LINE 實測

1. 在 LINE 聊天室重新輸入 `廠商專區`。
2. 點新卡片的 `核銷工作台`。
3. 已核准、已有廠商帳號的店家應直接進 POS。
4. 不應每次都要求重新輸入帳密。
5. POS 資料應先載入，再使用掃碼器。
6. 掃碼應顯示會員名稱、歷史消費總計、本次應付與折抵。
7. 核銷成功需有成功提示與提示音。

## 七、故障判斷

| 現象 | 優先檢查 |
| --- | --- |
| 每次都要求登入 | 新卡片是否帶 `portal_token`；是否拿舊 LINE 卡片測試；`vendor_portal_username` 是否存在 |
| POS 卡在讀取中 | `/api/vendor-pos` 是否先於 LIFF init；token 是否有效；console 是否有 syntax error |
| LINE 內相機打不開 | 是否走 LIFF URL；是否使用 `liff.scanCodeV2()`；參考 scanner runbook |
| 登入後瀏覽器可用、LINE 不行 | LINE WebView 快取或 storage 問題；確認 `no-store` 與直接 token URL |
| 已核准卻說未核准 | `welfare_vendors` 與 `welfare_vendor_line_sessions` 是否同步；以 vendor master 為準 |

## 八、下次改這段的最低原則

1. 不要用 LINE WebView 狀態當唯一登入依據。
2. POS 入口要能靠 `vendor_id + portal_token` 完整進入。
3. 帳密登入是主要登入，LIFF 是能力補充。
4. 公開頁與工作台頁必須分離。
5. 修完一定要重新從 LINE 產新卡片測試。
6. 不要只因直接網址可用，就判定 LINE 入口可用。
