# DATABASE

## 已確認的重要資料表

### welfare_vendors
用途：廠商主資料與審核狀態。

已確認欄位：
- id
- name
- status
- created_at
- updated_at
- is_hidden
- submitted_by_line_user_id
- contact_line_user_id

### line_webhook_events
用途：LINE Webhook 訊息、AI 分析與處理狀態。

已確認欄位：
- id
- event_id
- event_type
- source_type
- line_user_id
- message_type
- message_text
- raw_payload
- sentiment_type
- priority
- tags_json
- suggested_action
- process_status
- created_at
- ai_summary
- ai_severity
- ai_reason
- ai_reply_suggestion
- ai_analysis_json

### welfare_audit_events
用途：福委會系統稽核事件。

已確認欄位：
- id
- actor_type
- actor_id
- event_type
- target_type
- target_id
- summary
- raw_json
- created_at

### welfare_vendor_line_sessions
用途：既有廠商 LINE 流程狀態。

## Reader 原則

- 所有摘要 Reader 必須 SELECT-only。
- Reader 發生錯誤時回傳安全空結果。
- 不在 Chat Card Handler 內直接散落 SQL。
