# LINE Webhook

## Workspace 輸入來源

系統會優先讀取：

```text
item.postbackData
```

否則使用 LINE 文字內容。

## Workspace Entry

```text
maybeHandleLineDashboardCommand()
```

## 回覆責任

Workspace 流程應維持一次 `replyLineMessages()`。
