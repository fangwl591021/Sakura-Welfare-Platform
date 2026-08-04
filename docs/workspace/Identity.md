# Identity Core

## Provider 順序

1. Admin Provider
2. Vendor LINE Provider
3. Vendor Token Provider（有 verifier 時）

## Admin

以管理員 UID 白名單判斷。

## Vendor LINE

透過：

```text
welfare_vendors.submitted_by_line_user_id
welfare_vendors.contact_line_user_id
```

查找綁定廠商。

## Vendor Token

支援：
- portalToken
- portal_token
- vendorPortalToken

## 原則

- Provider 回傳標準 Identity。
- Provider 不修改 baseIdentity。
- Provider 發生 D1 錯誤時安全回傳 null。
