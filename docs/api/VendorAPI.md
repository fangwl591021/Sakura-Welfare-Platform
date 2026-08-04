# Vendor API

## 主要入口

- `/vendor-login`
- `/vendor-portal`
- `/vendor-store`
- `/vendor-pos`
- `/vendor-showcase`

## 身份方式

- LINE 綁定
- Vendor Portal Token

## 安全原則

- Vendor Workspace 查詢需排除 hidden vendor。
- Token 必須驗證 vendor_id 與 username。
- LINE 綁定需比對廠商資料表中的 LINE 欄位。
