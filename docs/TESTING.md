# TESTING

## 核心測試

```powershell
node --test "tests\workspace-dashboard.test.mjs"
node --test "tests\workspace-direct-keywords.test.mjs"
node --test "tests\workspace-chat-card-handler.test.mjs"
node --test "tests\workspace-live-summary-reader.test.mjs"
node --test "tests\identity-provider-registry.test.mjs"
```

## 語法與 Git 檢查

```powershell
node --check "src\index.js"
git diff --check
git status --short
```

## 測試原則

- 一個模組至少一個 focused test。
- Reader 測試必須驗證 SELECT-only。
- 非管理員不得呼叫 Loader。
- D1 失敗時必須安全降級。
- 直接關鍵字需有 regression tests。
