# AGENT_GUIDE

## 1. Agent 基本生命週期

```text
Start → Load Session → Handle Step → Validate → Confirm → Complete
```

## 2. Agent 必備欄位

```json
{
  "agent": "activity",
  "step": "activity_name",
  "status": "running",
  "payload": {}
}
```

## 3. 共通命令

- 取消
- 上一步
- 重新開始
- 確認
- 完成

## 4. 實作規範

- Agent 不直接猜測身份。
- Agent 不直接建立第二套身份系統。
- 讀取資料使用 Reader。
- 寫入資料使用專用 Writer。
- 每個 Step 必須可驗證。
- 每個 Agent 必須有 focused tests。
- 失敗時提供可恢復的訊息。
