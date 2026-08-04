# Live Summary

## Vendor Review Summary

查詢：
- 待審數量
- 最新待審廠商

條件：
```sql
status = 'pending'
AND COALESCE(is_hidden, 0) = 0
```

## Chat Monitor Summary

查詢：
- 未處理數量
- 高風險數量
- 最新未處理訊息

已完成狀態排除：
- resolved
- handled
- closed
- done
- archived

## Risk Summary

高風險條件：
- priority = high / critical
- ai_severity = high / critical
- sentiment_type = risk
