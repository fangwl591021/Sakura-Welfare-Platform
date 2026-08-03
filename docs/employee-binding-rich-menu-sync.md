# 員工綁定後 Rich Menu 同步流程

## 目標

員工身分驗證仍由母站完成。母站完成「工號 + 生日四碼」驗證並取得 LINE User ID 後，將綁定結果同步到子站。子站負責：

1. 寫入或更新 `welfare_members` 員工身分資料。
2. 依身分、語系、綁定狀態選出 `rich_menu_bindings` 規則。
3. 解析 alias 或正式 `richMenuId`。
4. 呼叫 LINE Rich Menu link API，將對應圖文選單綁到該 LINE 使用者。
5. 將套用結果寫入 `rich_menu_switch_checks`，方便追查切換是否成功。

## 母站與子站責任

母站：

- 驗證員工名冊。
- 判斷工號、生日四碼是否正確。
- 寫入母站會員綁定狀態。
- 完成後呼叫子站同步 API。

子站：

- 不再重新驗證生日。
- 只接收母站已驗證完成的綁定結果。
- 管理福利平台功能、頁面權限與 Rich Menu 對應。

## 子站同步 API

`POST /admin-api/employee-binding-sync`

Header:

```http
Content-Type: application/json
X-API-KEY: <SAKURA_BINDING_SYNC_KEY>
```

Body:

```json
{
  "line_user_id": "Uxxxxxxxxxxxxxxxx",
  "employee_code": "A12345",
  "employee_name": "王小明",
  "language": "zh-TW",
  "identity_type": "employee",
  "is_leave": 0,
  "mother_user_id": "14743",
  "line_checkin_datetime": "2026-07-22 17:43:45"
}
```

支援欄位別名：

- `line_user_id`, `line_userid`, `LINE_user_id`, `LINE_userid`, `LINE_USER_ID`, `lineUserId`, `lineUserID`, `line_id`, `lineId`, `LINE ID`, `user_login`
- `employee_code`, `employee_no`, `employeeCode`, `employeeNo`
- `employee_name`, `employeeName`, `display_name`, `displayName`
- `mother_user_id`, `motherUserId`, `user_id`, `userId`, `userid`, `User ID`
- `mother_reported_at`, `motherReportedAt`, `line_checkin_datetime`, `reported_at`, `checkin_at`, `報到時間`
- `language`, `lang`, `locale`, `preferred_language`

## 環境變數

必填：

- `SAKURA_BINDING_SYNC_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`

可替代同步金鑰：

- `EMPLOYEE_BINDING_SYNC_KEY`
- `MOTHER_MEMBER_API_KEY`
- `WETW_MEMBER_API_KEY`

建議使用獨立的 `SAKURA_BINDING_SYNC_KEY`，不要直接重用母站員工名冊 API Key。

## Rich Menu 規則

同步成功後，子站用以下條件從 `rich_menu_bindings` 找規則：

1. `target_type = employee`
2. `active = 1`
3. `language` 為空或符合員工語系
4. `bind_status` 為空或符合 `bound`
5. 依 `priority` 由小到大套用

若規則只有 alias，系統會先查 `rich_menu_projects` 的已部署 `deployed_rich_menu_id`，查不到才查 LINE alias API。
目前三語員工選單對應：

| 語系 | rich_menu_bindings.language | alias ID |
| --- | --- | --- |
| 繁中 | `zh-TW` | `twmem-menu` |
| 印尼文 | `id` | `indo-menu` |
| 泰文 | `th` | `taimem-menu` |

## 查詢同步狀態

`GET /admin-api/employee-binding-sync/status?line_user_id=Uxxxxxxxx`

或：

`GET /admin-api/employee-binding-sync/status?employee_code=A12345`

回傳目前子站保存的會員資料與匹配到的 Rich Menu 規則。

## 後台補同步母站名冊

`POST /admin-api/employee-binding-sync/pull-mother`

用途：當母站 callback 尚未到達或歷史資料尚未補齊時，管理員可在「用戶列表 CRM」按「同步資料」觸發補同步。同步對應順序為：母站 `line_id` / `line_user_id` 直接命中子站 LINE UID；若母站只提供 WordPress `User ID`，子站可透過母站點數帳本的明確 `user_id -> LINE_user_id` 紀錄反查；最後才用母站 `employee_code` 命中子站既有 `employee_no + line_user_id`。`line_checkin_datetime` 只作核對與稽核，不作自動綁定依據。

需要環境變數：

- `MOTHER_MEMBER_API_URL` 或 `WETW_MEMBER_API_URL`：選填；未設定時使用 `https://aiwe.cc/index.php/wp-json/wetw-member-list-skr/v1/member`
- `MOTHER_MEMBER_API_KEY` 或 `WETW_MEMBER_API_KEY`：必填；呼叫母站員工名冊 API 的 `X-API-KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`：若要同步後立即套用 Rich Menu，需可用
- `WETW_POINT_API_KEY` 或 `MOTHER_POINT_API_KEY`：選填；若需用母站 User ID 反查點數帳本的 LINE UID 時必填
- `MOTHER_POINT_SHOP_ID` 或 `WETW_POINT_SHOP_ID` 或 `SAKURA_SHOP_ID`：選填；若需用母站 User ID 反查點數帳本時必填

同步限制：

- 不重新驗證生日四碼，不取代母站員工驗證。
- 只使用可驗證的 LINE UID 來源：母站提供的有效 LINE UID、母站點數帳本明確 `user_id -> LINE_user_id` 對應，或用母站 `employee_code` 對上子站既有員工資料。若母站只提供內部 `User ID` 與 `line_checkin_datetime`，且點數帳本也查不到 LINE UID，子站不能安全自動綁定。
- 母站查無、離職或停用資料不會標記為 `bound`。
- Rich Menu 套用失敗時仍會保留綁定資料，並回傳套用狀態供後台追蹤。
## 已知限制

- 母站員工名單 API 文件目前只提供名單查詢與離職狀態更新，不能作為子站寫入綁定結果的唯一來源。
- 子站同步 API 必須由母站在完成綁定後主動呼叫。
- 若母站資料只有 `User ID` 與 `line_checkin_datetime`，但沒有有效 `line_id` / `line_user_id`，子站只會嘗試透過母站點數帳本反查明確 LINE UID；查不到時不會套用 Rich Menu，需母站補送 LINE UID 或由母站 callback 呼叫子站同步 API。
- 若 LINE alias 未部署或 Rich Menu ID 不存在，子站仍會保存員工綁定，但不會成功套用選單。
## 單筆母站資料診斷

`GET /admin-api/employee-binding-sync/mother-debug?employee_code=1007475&line_user_id=Uxxxxxxxx`

用途：管理員在「用戶列表 CRM」檢查母站已報到、但子站仍顯示 `unbound` 的個案。此端點只讀取資料，不寫入 D1、不套用 Rich Menu。

診斷順序：

1. 用 `employee_code` 查母站員工名冊。
2. 若母站名冊直接提供 `line_id` / `line_user_id`，視為安全 LINE UID 來源。
3. 若母站只提供 WordPress `user_id`，嘗試用母站點數帳本反查 `user_id -> LINE_user_id`。
4. 若仍查不到，只能顯示管理員目前在子站選取的 LINE UID，不可用姓名或報到時間猜測自動綁定。
5. 比對子站 `welfare_members` 是否已有該 LINE UID 或該員工代號資料。

安全限制：回傳結果會遮罩 LINE UID；此端點不回傳 API Key、Channel Token 或其他機密。
