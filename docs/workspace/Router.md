# Workspace Router

## 功能

將 LINE 文字或 postback 轉換成 Workspace Intent。

## 已支援直接關鍵字

- 儀表板
- 仪表板
- 新增活動
- 訊息推播
- 廠商審核
- 聊天室監控
- AI 風險中心
- 廠商專區
- 厂商专区

## Postback Actions

```text
action=workspace.activity.create
action=workspace.push.create
action=workspace.vendor.review
action=workspace.chat.monitor
action=workspace.risk.list
```

## 原則

Router 只做辨識，不做身份判斷與資料查詢。
