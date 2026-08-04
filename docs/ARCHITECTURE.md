# SAKURA AI Workspace Platform Architecture

## 1. 平台目標

以 LINE 聊天室作為主要營運工作介面，讓管理員、廠商與後續其他角色能在相同平台完成查詢、審核、推播與風險處理。

## 2. 核心架構

```text
LINE Event
  → Workspace Intent Router
  → Identity Provider Registry
  → Workspace Handler
  → Chat Card / Agent Flow
  → Read-only Reader / Writer
  → D1 / R2 / LINE API
```

## 3. 已完成模組

### Identity Core
- Admin Identity Provider
- Vendor LINE Identity Provider
- Vendor Token Identity Provider
- Provider Registry

### Workspace
- 儀表板
- 新增活動
- 訊息推播
- 廠商審核
- 聊天室監控
- AI 風險中心
- 廠商專區 Intent

### Chat Cards
- 活動：快速建立／進階建立
- 推播：立即／排程／草稿
- 廠商審核：待審數量／第一筆
- 聊天室監控：未處理／高風險／最新摘要
- AI 風險中心：高風險數量／最新事件

## 4. 設計原則

- 身份判斷集中於 Identity Core。
- 查詢功能優先採唯讀 Reader。
- LINE reply 維持單一回覆責任。
- Chat Card 為第一層入口，複雜操作再進 Agent 或完整網頁。
- 所有模組需有 focused tests。
- 部署必須使用 `wrangler.sakura-welfare.toml`。
