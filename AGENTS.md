# AGENTS - Sakura Welfare Platform

This file defines the working rule for Codex and other coding agents in this repository.

## Required Reading Before Changes

Before editing code, read:

1. `PROJECT_BRIEF.md`
2. `PROJECT_STATUS.md`
3. `ARCHITECTURE.md`
4. `DECISIONS.md`
5. `KNOWN_ISSUES.md`
6. `NEXT_SPRINT.md`
7. The specific route/module source file being changed.
8. Any relevant file under `docs/`.

If any of these files conflict with Tony's latest instruction, Tony's latest instruction wins. Update the relevant document after implementation if the decision is durable.

## Change Rules

- Do not replace frameworks, database, deployment target, login model, or webhook authority without explicit approval.
- Do not create a second implementation for an existing feature.
- Prefer narrow patches to `src/index.js` and existing HTML source files.
- Do not edit unrelated features while fixing one issue.
- Do not expose secrets, API keys, channel secrets, or tokens in Git.
- Do not claim a test passed unless it was actually run.
- When changing inline HTML scripts, validate syntax.

## Deployment Rule

For Sakura Worker deploys, use:

```powershell
npx.cmd wrangler deploy -c wrangler.sakura-welfare.toml
```

Never use bare `wrangler deploy` unless the target has been explicitly confirmed.

## Minimum Verification

For Worker code changes:

```powershell
node --check src\index.js
```

For route-specific inline scripts, extract and check the live script when feasible.

For D1 schema changes:

```powershell
npx.cmd wrangler d1 migrations apply sakura-welfare-db --remote -c wrangler.sakura-welfare.toml
```

## Reporting Format

Each completed task should report:

- Files changed.
- Behavior changed.
- Tests run.
- Deployment status if deployed.
- Remaining risks.

