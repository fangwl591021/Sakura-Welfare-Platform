# GAS API 對接契約

Worker 只負責畫面、R2 附件儲存與 API 轉發；申請資料、審查資料、年度設定、審核人員分派仍需由 Google Apps Script 儲存與處理。

## 共用格式

前端會以 `POST /api` 呼叫 Worker，Worker 再轉發到 `GAS_URL`。

```json
{
  "action": "submit",
  "data": {}
}
```

GAS 建議統一回傳：

```json
{
  "success": true,
  "message": "完成",
  "data": {}
}
```

## action: submit

建立或補件修改申請資料。

Worker 會先把附件存入 R2，再把附件 base64 欄位移除，改送 URL 給 GAS。

主要欄位：

```json
{
  "editAppId": "",
  "applicationYear": "第三十七屆",
  "academicYear": "113學年度",
  "group": "特殊才藝組",
  "studentName": "王小明",
  "gender": "男性",
  "school": "成功大學",
  "grade": "一",
  "department": "資訊工程學系",
  "age": "20",
  "intellectTop": "90",
  "intellectBottom": "91",
  "moralTop": "85",
  "moralBottom": "86",
  "talentOrganizer": "教育部",
  "talentCategory": "語文",
  "talentResult": "第一名",
  "messageToSakura": "感謝櫻花教育獎學金",
  "employeeName": "王大明",
  "relationship": "父子",
  "applicantName": "王大明(sakura\\1000001)",
  "businessUnit": "總管理處",
  "employeeDept": "人資部",
  "employeeId": "A123456789",
  "phone": "0912345678",
  "email": "test@sakura.com.tw",
  "address": "台中市...",
  "applicantConfirm": "我同意",
  "confirmDate": "2026-05-08",
  "agreeTerms": true,
  "status": "待初審",
  "prelimStatus": "待初審",
  "finalStatus": "待複審",
  "photoUrl": "https://.../file/photo_...",
  "transcriptUrl": "https://.../file/transcript_first_...\\nhttps://.../file/transcript_second_...",
  "transcriptUrls": [
    { "semester": "first", "name": "王小明-上學期.pdf", "mimeType": "application/pdf", "url": "https://..." },
    { "semester": "second", "name": "王小明-下學期.pdf", "mimeType": "application/pdf", "url": "https://..." }
  ]
}
```

GAS 應做：

- 若 `editAppId` 空白：新增一筆申請，產生申請編號。
- 若 `editAppId` 有值：更新原資料，狀態改成 `已重新補件` 或依內規處理。
- 依 `businessUnit` 分派初審人員。
- 儲存全部欄位到 Google Sheet。

## action: check

申請者查詢進度。

輸入：

```json
{
  "employeeId": "A123456789",
  "studentName": "王小明"
}
```

回傳 `data` 建議包含完整欄位，至少要有：

```json
{
  "success": true,
  "data": {
    "appId": "HR-training250800001",
    "studentName": "王小明",
    "group": "大專組",
    "status": "需補件",
    "prelimStatus": "需補件",
    "finalStatus": "待複審",
    "supplementNote": "請補第二學期成績證明"
  }
}
```

## action: getAll

後台總明細。

輸入：

```json
{
  "password": "後台密碼"
}
```

回傳：

```json
{
  "success": true,
  "data": [
    {
      "rowIndex": 2,
      "appId": "HR-training250800001",
      "createdAt": "2026-05-08T10:00:00.000Z",
      "studentName": "王小明",
      "businessUnit": "總管理處",
      "group": "大專組",
      "status": "待初審",
      "prelimStatus": "待初審",
      "finalStatus": "待複審",
      "photoUrl": "https://...",
      "transcriptUrl": "https://..."
    }
  ]
}
```

前端匯出 CSV 會直接使用 `getAll` 回傳資料。

## action: updateStatus

後台更新審查狀態。

輸入：

```json
{
  "rowIndex": 2,
  "newStatus": "初審通過",
  "note": "",
  "password": "後台密碼"
}
```

建議狀態：

- `待初審`
- `初審通過`
- `待複審`
- `複審通過`
- `需補件`
- `已重新補件`
- `退件`
- `獲得獎學金`

## action: delete

後台刪除申請資料。

輸入：

```json
{
  "rowIndex": 2,
  "password": "後台密碼"
}
```

若需要保留稽核紀錄，建議 GAS 不是真的刪除列，而是標記 `deletedAt`。
