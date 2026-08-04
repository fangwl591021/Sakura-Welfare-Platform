# Agent Runtime

## 目標

讓活動、推播、廠商審核、聊天室與風險處理共用同一套多步驟流程。

## 建議介面

```js
start(context)
resume(session, input)
validate(step, input)
confirm(session)
complete(session)
cancel(session)
```

## Session 建議格式

```json
{
  "agent": "activity",
  "step": "activity_name",
  "status": "running",
  "payload": {},
  "updatedAt": "ISO-8601"
}
```

## 尚未完成

本文件為 Sprint 3 實作規格，Agent Runtime 尚未正式接入。
