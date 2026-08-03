# 福委會消費紀錄查詢 API 規格書

版本：v1.0  
適用系統：櫻花福委會福利資訊整合平台  
資料來源：子站 D1 `welfare_redemptions`  
主要查詢鍵：LINE User ID

## 1. 文件目的

本文件提供福委會後台、客服查詢與營運報表使用的「會員消費紀錄查詢」規格。用途是讓福委會依會員 LINE User ID 查詢其在特約店家的核銷、折抵與實付紀錄。

此 API 屬於福委會查詢用途，不是母站點數 API，也不負責員工身份驗證。

## 2. 使用場景

1. 福委會客服查詢會員在特約店家的消費折抵紀錄。
2. 福委會處理店家或會員消費爭議。
3. 福委會產出特約廠商合作效益、折抵成效與使用率報表。
4. 會員端查詢自己的消費紀錄。
5. 店家對帳時輔助核對單筆消費是否已完成核銷。

## 3. 系統邊界

| 項目 | 權責 |
| --- | --- |
| 員工身份驗證 | 母站 |
| 員工綁定結果同步 | 子站接收並套用 |
| 消費核銷紀錄 | 子站 D1 |
| 點數新增、扣點、查詢 | 母站點數 API |
| 福委會消費紀錄查詢 | 子站 API |

注意：本 API 只查詢消費與折抵紀錄，不寫入母站點數，不修改會員身份，不執行核銷。

## 4. 目前可用 API

### 4.1 查詢會員消費紀錄

```http
GET /api/member-redemptions
```

### Query 參數

| 參數 | 必填 | 說明 |
| --- | --- | --- |
| line_user_id | 是 | LINE User ID |
| uid | 否 | `line_user_id` 的相容別名 |
| months | 否 | 查詢最近幾個月，預設 6，最大 24 |

### 範例

```http
GET https://sakura-welfare-platform.fangwl591021.workers.dev/api/member-redemptions?line_user_id=U35b26d3c1642af71a3f2fce76b745ea7&months=6
```

### cURL

```bash
curl -X GET "https://sakura-welfare-platform.fangwl591021.workers.dev/api/member-redemptions?line_user_id=U35b26d3c1642af71a3f2fce76b745ea7&months=6"
```

## 5. 建議福委會後台 API

目前 `/api/member-redemptions` 可供會員端查詢。若要給福委會後台使用，建議另建受權限保護的管理 API：

```http
POST /admin-api/welfare-consumption-records
Content-Type: application/json
```

### Request

```json
{
  "line_user_id": "U35b26d3c1642af71a3f2fce76b745ea7",
  "date_start": "2026-07-01",
  "date_end": "2026-07-31",
  "vendor_id": "",
  "status": "confirmed",
  "page": 1,
  "per_page": 20
}
```

### Request 欄位

| 參數 | 必填 | 說明 |
| --- | --- | --- |
| line_user_id | 是 | LINE User ID |
| date_start | 否 | 起始日期，格式 `YYYY-MM-DD` |
| date_end | 否 | 結束日期，格式 `YYYY-MM-DD` |
| vendor_id | 否 | 特約廠商 ID |
| status | 否 | 核銷狀態，預設 `confirmed` |
| page | 否 | 頁碼，預設 1 |
| per_page | 否 | 每頁筆數，預設 20，最大 100 |

## 6. Response 範例

```json
{
  "success": true,
  "code": "query_success",
  "message": "查詢成功",
  "data": {
    "member": {
      "line_user_id": "U35b26d3c1642af71a3f2fce76b745ea7",
      "display_name": "Tonyfang",
      "member_type": "employee",
      "employee_code": "1004579"
    },
    "summary": {
      "count": 3,
      "original_total": 930,
      "payable_total": 774,
      "discount_total": 156
    },
    "pagination": {
      "page": 1,
      "per_page": 20,
      "total": 3,
      "total_pages": 1
    },
    "rows": [
      {
        "id": 101,
        "vendor_id": "line-vendor-001",
        "vendor_name": "米樂香氛",
        "offer_id": "offer-001",
        "offer_title": "員工限定 8 折",
        "original_price": 100,
        "payable_price": 80,
        "discount_amount": 20,
        "remark": "food",
        "status": "confirmed",
        "redeemed_at": "2026-07-06 16:09:46"
      }
    ]
  }
}
```

## 7. 錯誤回應

### 缺少 LINE User ID

```json
{
  "success": false,
  "code": "missing_line_user_id",
  "message": "缺少 LINE User ID"
}
```

### 查無資料

查無資料不應視為錯誤，應回傳成功與空陣列。

```json
{
  "success": true,
  "code": "query_success",
  "message": "查詢成功",
  "data": {
    "member": {
      "line_user_id": "Uxxxxxxxx",
      "display_name": "",
      "member_type": ""
    },
    "summary": {
      "count": 0,
      "original_total": 0,
      "payable_total": 0,
      "discount_total": 0
    },
    "rows": []
  }
}
```

## 8. 權限規則

| 使用者 | 查詢範圍 |
| --- | --- |
| 福委會管理員 | 可查詢全部會員消費紀錄 |
| 福委會委員 | 依模組權限查詢 |
| 客服人員 | 單一會員查詢 |
| 廠商 | 不使用此 API；廠商只能查詢自己店家的核銷紀錄 |
| 一般會員 | 只能查詢自己的消費紀錄 |

## 9. 欄位對應

| API 欄位 | D1 來源 | 說明 |
| --- | --- | --- |
| line_user_id | `welfare_redemptions.line_user_id` | 會員 LINE User ID |
| member_type | `welfare_redemptions.member_type` 或 CRM 資料 | 員工、訪客、廠商、管理員 |
| vendor_id | `welfare_redemptions.vendor_id` | 特約廠商 ID |
| vendor_name | 廠商資料表 | 店家名稱 |
| offer_id | `welfare_redemptions.offer_id` | 優惠 ID |
| original_price | `welfare_redemptions.original_price` | 消費金額 |
| payable_price | `welfare_redemptions.payable_price` | 實付金額 |
| discount_amount | `welfare_redemptions.discount_amount` | 折抵金額 |
| remark | `welfare_redemptions.remark` | 店家核銷備註 |
| redeemed_at | `welfare_redemptions.redeemed_at` | 核銷時間 |
| status | `welfare_redemptions.status` | 核銷狀態 |

## 10. 不應回傳的資料

為避免資安與個資風險，福委會查詢 API 不應回傳：

1. QR token 或短效核銷碼。
2. 廠商 portal token。
3. API key、Channel Secret、Channel Access Token。
4. 原始 LINE webhook payload。
5. 與查詢目的無關的生日、完整員工名冊或敏感個資。

## 11. 福委會後台畫面建議

福委會後台可做成「會員消費紀錄」頁：

1. 查詢條件：LINE 名稱、LINE User ID、員工工號、日期區間、店家、分類。
2. 摘要卡：筆數、消費金額、實付金額、折抵金額。
3. 明細表：店家、優惠、消費金額、實付、折抵、時間、備註。
4. 匯出：CSV / Excel。
5. 權限：只允許福委會管理員或指定委員使用。

## 12. 驗收項目

| 項目 | 驗收標準 |
| --- | --- |
| 依 LINE User ID 查詢 | 可查到指定會員消費紀錄 |
| 無資料處理 | 回傳成功與空陣列，不顯示錯誤 |
| 金額統計 | 筆數、原消費、實付、折抵統計正確 |
| 權限控管 | 非授權人員不可查詢他人紀錄 |
| 敏感資料 | 不回傳 QR token、secret、webhook 原始資料 |
| 匯出 | 福委會可匯出報表 |

## 13. 目前狀態

目前已存在會員端查詢 API：

```http
GET /api/member-redemptions?line_user_id={LINE_USER_ID}&months=6
```

若福委會要在後台查詢全部會員或指定會員紀錄，下一步應新增：

```http
POST /admin-api/welfare-consumption-records
```

並套用後台登入權限與 UID 白名單權限。
