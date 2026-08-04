# DEPLOYMENT

## 正式部署目標

```text
Worker: sakura-welfare-platform
D1: sakura-welfare-db
R2: sakurakitchen-files
Config: wrangler.sakura-welfare.toml
```

## 正確部署指令

```powershell
npm.cmd run deploy:welfare
```

這個指令會先執行：

```text
predeploy:welfare
```

再部署：

```text
wrangler deploy -c wrangler.sakura-welfare.toml
```

## 禁止使用

```powershell
npx.cmd wrangler deploy
```

未指定設定檔時會使用預設 `wrangler.toml`，可能誤部署到 `sakuragroup`。

## 部署前檢查

```powershell
git status --short
node --check "src\index.js"
npm.cmd run predeploy:welfare
```
