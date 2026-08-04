# welfare_vendors

## 用途

廠商主資料、審核狀態、LINE 綁定與 Portal 資訊。

## Workspace 使用方式

- Vendor LINE Reader
- Vendor By ID Reader
- Vendor Review Summary Reader

## 審核摘要條件

```sql
status = 'pending'
AND COALESCE(is_hidden, 0) = 0
```
