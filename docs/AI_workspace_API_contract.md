# 櫻花福委會 AI Workspace API Contract

- 文件版本：V1.0
- API 版本：`v1`
- 更新日期：2026-08-03
- 適用系統：櫻花福委會福利資訊整合平台
- 文件狀態：目標契約（各端實作前的共同基準）

## 1. 文件目的

本文件定義櫻花福委會 AI Workspace 與既有系統之間的 API 契約，確保 LINE OA、LIFF Workspace、管理後台、Codex 與 Worker Service Layer 使用相同介面、權限與錯誤語意。

本文件不改變既有資料表與權責；實作時應以 Service Layer 封裝既有功能，不得由前端或 AI 直接操作 D1。

## 2. 契約原則

1. API 一律經過 Service Layer，不向前端暴露 SQL 或 D1 結構。
2. 所有管理 API 必須先驗證身分、角色與模組權限。
3. 成功、失敗、分頁與 request ID 格式統一。
4. AI 只能摘要、分類、預覽、草擬與建議，不可自動執行高風險動作。
5. 發布、推播、廠商審核、客服回覆與風險處置必須人工確認。
6. 可重試的寫入 API 必須支援冪等鍵，避免重複發布、推播或審核。
7. LINE OA 仍只有一個 reply owner；Workspace API 不得與現有 Webhook 重複消耗 `replyToken`。
8. 員工身分與點數仍由母站掌握，Workspace 不得建立第二個權威來源。

## 3. 基本約定

### 3.1 Base Path

所有 V1 Workspace API 統一使用：

```text
/api/workspace/v1
```

例如：

```http
GET /api/workspace/v1/dashboard
```

若系統目前已有無版本路徑，可在過渡期保留 alias，但新功能應以 V1 路徑為準。

### 3.2 Content Type

```http
Content-Type: application/json; charset=utf-8
Accept: application/json
```

檔案上傳應使用獨立的 R2 上傳服務或 `multipart/form-data`，不在本契約的 JSON 欄位中傳送大型 Base64。

### 3.3 時間與時區

- API 時間使用 ISO 8601，儲存與傳輸以 UTC 為主。
- 前端預設以 `Asia/Taipei` 顯示。
- 例：`2026-08-03T10:30:00Z`。

### 3.4 Request Headers

```http
Authorization: Bearer <workspace_session_token>
X-Request-Id: <uuid>
Idempotency-Key: <uuid>          # 只用於可重試的寫入請求
X-Confirm-Token: <short_lived>    # 只用於需人工二次確認的動作
```

LIFF 情境可以 LIFF ID token 換取 Workspace Session，但不應在每個業務 API 重複傳送 LINE profile 當作授權依據。

## 4. 統一 Response

### 4.1 成功

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "8dd7c40d-7b25-4b96-9168-9aeab0a2d9fd",
    "timestamp": "2026-08-03T10:30:00Z"
  }
}
```

### 4.2 分頁成功

```json
{
  "ok": true,
  "data": {
    "items": []
  },
  "meta": {
    "requestId": "8dd7c40d-7b25-4b96-9168-9aeab0a2d9fd",
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

### 4.3 失敗

```json
{
  "ok": false,
  "code": "PERMISSION_DENIED",
  "message": "您沒有權限執行此操作",
  "details": {},
  "meta": {
    "requestId": "8dd7c40d-7b25-4b96-9168-9aeab0a2d9fd",
    "timestamp": "2026-08-03T10:30:00Z"
  }
}
```

`message` 用於人員閱讀，程式判斷只能依據穩定的 `code`。不得在回應中暴露 SQL、secret、token 或堆疊追蹤。

## 5. Authentication

### 5.1 支援的身分來源

1. **Workspace Session**：管理後台登入後簽發的短效 session。
2. **LIFF Session**：後端驗證 LIFF ID token 後簽發的 Workspace Session。
3. **LINE OA Webhook Context**：只能由已驗簽的 Worker 內部轉換，不接受前端自行宣告 LINE User ID。

### 5.2 授權順序

1. 驗證 token 簽章、有效期與 issuer。
2. 解析 `userId`、`role` 與可用模組。
3. 對照 UID 白名單與角色權限。
4. 對寫入動作再驗證人工確認 token。
5. 對廠商資源強制驗證所有權，廠商只能讀寫自己的資料。

## 6. Dashboard Summary

### `GET /api/workspace/v1/dashboard`

用途：取得 AI Workspace 首頁即時摘要。

權限：`admin`

查詢參數：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `timezone` | 否 | 預設 `Asia/Taipei` |

回傳範例：

```json
{
  "ok": true,
  "data": {
    "pendingVendorCount": 3,
    "publishedOfferCount": 18,
    "todayRedemptionCount": 24,
    "todayRedemptionAmount": 16840,
    "pendingChatCount": 5,
    "highRiskCount": 1,
    "todoItems": [
      {
        "type": "vendor_review",
        "label": "3 家廠商待審",
        "priority": "high"
      }
    ],
    "entries": [
      "activity",
      "push",
      "vendor_review",
      "risk",
      "chat"
    ]
  },
  "meta": {
    "requestId": "8dd7c40d-7b25-4b96-9168-9aeab0a2d9fd",
    "generatedAt": "2026-08-03T10:30:00Z"
  }
}
```

本 API 為唯讀，不得寫入 D1、發送 LINE 訊息或觸發審核動作。

## 7. Activity Workspace

### `POST /api/workspace/v1/activity/draft`

用途：建立活動草稿。

權限：`admin`，或經授權的 `vendor`。

Request：

```json
{
  "title": "夏日健走活動",
  "activityType": "club",
  "club": "登山社",
  "coverImage": "r2://activities/2026/summer-walk.jpg",
  "content": "活動內容",
  "eventDate": "2026-08-20T01:00:00Z",
  "location": "台中市",
  "quota": 80,
  "audiences": ["employee"],
  "qrCheckinEnabled": true
}
```

Response `data`：

```json
{
  "activityId": "act_01K1ABCDEF",
  "status": "draft"
}
```

### `POST /api/workspace/v1/activity/publish`

用途：正式發布活動草稿。

權限：`admin`

限制：

- 必須傳送 `X-Confirm-Token`。
- 必須傳送 `Idempotency-Key`。
- 必須寫入 Audit Log。

Request：

```json
{
  "activityId": "act_01K1ABCDEF",
  "expectedStatus": "draft"
}
```

Response `data`：

```json
{
  "activityId": "act_01K1ABCDEF",
  "status": "published",
  "publishedAt": "2026-08-03T10:30:00Z"
}
```

## 8. Push Workspace

### `GET /api/workspace/v1/push/audience`

用途：預估分眾推播受眾，不發送訊息。

權限：`admin`

查詢範例：

```text
?tags=employee,taichung&activityId=act_01K1ABCDEF
```

Response `data`：

```json
{
  "audienceCount": 428,
  "tags": ["employee", "taichung"],
  "excludedCount": 12
}
```

### `POST /api/workspace/v1/push/draft`

用途：建立推播草稿與預覽，不發送訊息。

Request：

```json
{
  "title": "活動提醒",
  "audience": {
    "tags": ["employee", "taichung"]
  },
  "message": {
    "type": "flex",
    "altText": "活動提醒",
    "contents": {}
  }
}
```

Response `data`：

```json
{
  "pushDraftId": "push_01K1ABCDEF",
  "status": "draft",
  "audienceCount": 428
}
```

### `POST /api/workspace/v1/push/send`

用途：正式發送已確認的推播草稿。

權限：`admin`

限制：二次確認、`Idempotency-Key`、Audit Log，並必須先完成受眾人數預覽。

Request：

```json
{
  "pushDraftId": "push_01K1ABCDEF",
  "confirmedAudienceCount": 428
}
```

## 9. Vendor Review

### `GET /api/workspace/v1/vendors/pending`

用途：取得待審廠商清單。

權限：`admin`

查詢參數：`page`、`pageSize`、`status`、`keyword`。

Response item：

```json
{
  "vendorId": "vendor_01K1ABCDEF",
  "name": "示範特約店家",
  "applyDate": "2026-08-03T08:00:00Z",
  "status": "pending",
  "missingDocumentCount": 1,
  "riskLevel": "medium"
}
```

### `POST /api/workspace/v1/vendors/review`

用途：審核廠商申請。

權限：`admin`

限制：人工確認、`Idempotency-Key`、Audit Log。

Request：

```json
{
  "vendorId": "vendor_01K1ABCDEF",
  "action": "request_more",
  "comment": "請補上有效的保險文件",
  "expectedStatus": "pending"
}
```

`action` 僅允許：

- `approve`
- `reject`
- `request_more`

若 `expectedStatus` 與當前狀態不同，回傳 `STATE_CONFLICT`，避免覆寫其他管理員已完成的審核。

## 10. Risk Center

### `GET /api/workspace/v1/risk`

用途：取得風險事件與 AI 建議。

權限：`admin`

查詢參數：`severity`、`status`、`page`、`pageSize`。

Response item：

```json
{
  "riskId": "risk_01K1ABCDEF",
  "severity": "high",
  "title": "廠商優惠無法使用",
  "summary": "24 小時內已有 3 位員工回報",
  "suggestedAction": "確認優惠狀態並聯繫廠商",
  "status": "open",
  "evidenceCount": 3
}
```

AI 建議不等於系統決策，不得因為命中風險就自動停權廠商、扣點、退款或結案。

## 11. Chat Monitor

### `GET /api/workspace/v1/chat/pending`

用途：取得待處理聊天室清單。

權：`admin`

Response item：

```json
{
  "conversationId": "user:U1234567890",
  "userName": "王小明",
  "unreadCount": 2,
  "priority": "high",
  "latestMessageAt": "2026-08-03T10:20:00Z"
}
```

### `POST /api/workspace/v1/chat/reply-preview`

用途：依聊天內容產生回覆草稿，不發送 LINE 訊息。

Request：

```json
{
  "conversationId": "user:U1234567890",
  "message": "請協助確認廠商優惠使用方式"
}
```

Response `data`：

```json
{
  "aiSuggestion": "您好，我們已收到您的回報，正在協助確認廠商優惠使用方式。",
  "confidence": 0.86,
  "requiresHumanReview": true
}
```

### 後續預留：`POST /api/workspace/v1/chat/reply`

本 V1 契約不允許 AI 直接發送。若後續實作人工發送 API，必須使用 `X-Confirm-Token`、寫入 Audit Log，並遵守 LINE 單一 reply owner 規則。

## 12. Permission Matrix

| API 模組 | Admin | Vendor | Employee |
| --- | --- | --- | --- |
| Dashboard | 可 | 不可 | 不可 |
| Activity Draft | 可 | 依模組授權 | 不可 |
| Activity Publish | 可 | 不可 | 不可 |
| Push Audience / Draft / Send | 可 | 不可 | 不可 |
| Vendor Pending / Review | 可 | 不可 | 不可 |
| Risk Center | 可 | 不可 | 不可 |
| Chat Pending / Reply Preview | 可 | 不可 | 不可 |

管理員仍需符合 UID 白名單與模組權限，不可只依據前端傳入的 `role=admin`。

## 13. Error Codes

| Code | 建議 HTTP Status | 說明 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 缺少登入或 token |
| `SESSION_EXPIRED` | 401 | session 過期 |
| `PERMISSION_DENIED` | 403 | 已登入但沒有權限 |
| `NOT_FOUND` | 404 | 資源不存在或不允許顯示 |
| `VALIDATION_ERROR` | 422 | 欄位格式或必填資料錯誤 |
| `CONFIRMATION_REQUIRED` | 409 | 高風險動作尚未人工確認 |
| `STATE_CONFLICT` | 409 | 資源狀態已被其他操作改變 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一冪等鍵對應不同內容 |
| `RATE_LIMIT` | 429 | 請求過於頻繁 |
| `WEBHOOK_CONFLICT` | 409 | 可能造成重複回覆或 replyToken 衝突 |
| `UPSTREAM_UNAVAILABLE` | 502 | LINE、母站或其他上游服務無法使用 |
| `INTERNAL_ERROR` | 500 | 未預期系統錯誤 |

Validation error 可在 `details.fields` 回傳欄位錯誤：

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "message": "請確認必填資料",
  "details": {
    "fields": {
      "title": "不可為空白",
      "eventDate": "日期必須晚於現在"
    }
  },
  "meta": {
    "requestId": "8dd7c40d-7b25-4b96-9168-9aeab0a2d9fd"
  }
}
```

## 14. Audit Log

下列動作必須留下不可靜默略過的稽核紀錄：

- Activity Publish
- Push Send
- Vendor Review
- Chat Reply
- Risk Action

最低記錄欄位：

```json
{
  "auditId": "audit_01K1ABCDEF",
  "requestId": "8dd7c40d-7b25-4b96-9168-9aeab0a2d9fd",
  "userId": "U1234567890",
  "role": "admin",
  "action": "vendor.review.request_more",
  "resourceType": "vendor",
  "resourceId": "vendor_01K1ABCDEF",
  "request": {},
  "result": {
    "ok": true,
    "beforeStatus": "pending",
    "afterStatus": "request_more"
  },
  "timestamp": "2026-08-03T10:30:00Z"
}
```

稽核紀錄不得寫入密碼、access token、channel secret、API key 或完整個人敏感文件內容。

## 15. 冪等與并發

1. `activity/publish`、`push/send` 與 `vendors/review` 必須使用 `Idempotency-Key`。
2. 相同鍵與相同 request body 重試時，應回傳原執行結果。
3. 相同鍵但 request body 不同時，回傳 `IDEMPOTENCY_CONFLICT`。
4. 狀態轉換應帶 `expectedStatus`，避免並發覆寫。
5. 推播草稿發送後不得再以同一草稿發送，除非建立新草稿並重新確認。

## 16. 版本策略

目前版本：**AI Workspace API v1**。

- 非 Breaking Change：可增加可選欄位、新 endpoint 或新 error code，但不得改變現有欄位語意。
- Breaking Change：刪除欄位、改變型別、改變權限語意或讓既有 request 失效時，必須升級為 `/v2`。
- V1 與 V2 並存期間必須明確標示停用日期，不得直接修改已發佈契約。

## 17. V1 驗收清單

- [ ] 所有 endpoint 回傳統一 `ok/data/meta` 或 `ok/code/message` 格式。
- [ ] 未登入、session 過期、非管理員與模組無權限均有自動化測試。
- [ ] Dashboard 只讀，請求前後 D1 無任何寫入。
- [ ] 高風險動作無 `X-Confirm-Token` 時必須拒絕。
- [ ] 可重試寫入動作有冪等測試，不產生重複紀錄或重複推播。
- [ ] Vendor 不能讀取其他廠商資料。
- [ ] Chat Reply Preview 不會發送 LINE 訊息。
- [ ] LINE Webhook 沒有重複消耗 `replyToken`。
- [ ] Audit Log 包含 actor、action、resource、result 與 timestamp，且不含 secret。
- [ ] 所有日期可正確轉換為台灣時間顯示。
- [ ] 新增 API 有契約測試，Breaking Change 不得佔用 V1 原路徑。

## 18. 實作順序

1. 先建立共用 response、error、auth 與 request ID middleware。
2. 以現有唯讀 Dashboard Summary 為第一個 V1 endpoint。
3. 實作 Activity Draft，但在確認機制與 Audit Log 完成前不開放 Publish。
4. 實作 Push Audience 與 Draft，正式 Send 必須最後開放。
5. 將 Vendor Review、Risk Center 與 Chat Monitor 接到現有 Service Layer。
6. 完成權限、冪等、稽核、上游失敗與 LINE 單一回覆的整合驗收。
