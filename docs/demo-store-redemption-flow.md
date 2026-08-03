# 示範店家與核銷模型驗收流程

## 角色入口

- 員工 / 用戶端：`/member-app`
- 廠商微官網：`/demo-store`
- 店家核銷工作台：`/vendor-pos`
- 單筆掃碼核銷頁：`/vendor-redeem?token=...`
- 福委會後台折抵紀錄：`/vendor-management?module=redemptions`

## 示範資料

- 廠商：示範特約店家
- 廠商編號：SAMPLE001
- 商店網址 / 微官網：`/demo-store`
- 優惠：員工限定套餐 8 折
- 原價：100
- 員工價：80
- 訪客價：100
- 核銷方式：5 分鐘短效 token

## 核銷模型

1. 員工在 `/member-app` 或 `/demo-store` 產生核銷碼。
2. 系統建立 `welfare_redemption_tokens`，狀態為 `active`，有效期 5 分鐘。
3. 店家以 `/vendor-redeem?token=...` 或 `/vendor-pos` 檢查 token。
4. 店家確認原價與操作員後送出核銷。
5. 後端先以條件更新鎖定 token，避免同一張碼重複核銷。
6. 系統寫入 `welfare_redemptions`，記錄原價、實付、折抵、會員身分與店家。
7. token 更新為 `used`，並寫回 redemption id。
8. 福委會可在 `/vendor-management?module=redemptions` 查看折抵紀錄。

## 驗收項目

- 員工端能顯示會員身分與示範優惠。
- 員工端能產生 5 分鐘有效核銷碼。
- 店家端能輸入 token 並看到優惠、會員與應付金額。
- 店家端核銷後會新增折抵紀錄。
- 同一個 token 第二次核銷會被阻擋。
- token 過期後會被判定為失效。
- 廠商端能看到今日核銷、今日實收、今日折抵與最近核銷。
- 後台折抵紀錄能看到對應交易。

## 部署指令

```powershell
$env:WRANGLER_LOG_PATH='D:\OneDrive\文件\New project 5\.wrangler-logs'
$env:WRANGLER_SEND_METRICS='false'
npx.cmd wrangler d1 migrations apply sakura-welfare-db --remote
npx.cmd wrangler deploy
```

備註：Worker 已加入自動建立 `welfare_redemption_tokens` 的保險機制，即使尚未手動套用 migration，第一次使用核銷 API 時仍會嘗試建立資料表。
