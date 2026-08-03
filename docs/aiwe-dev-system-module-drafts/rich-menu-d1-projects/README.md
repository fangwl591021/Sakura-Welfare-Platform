# Module Draft - Rich Menu D1 Project Manager

Status: Candidate for reuse.

Verified source project: Sakura Welfare Platform.

## Purpose

Manage LINE Rich Menu projects with D1 as source of truth, including image, hot areas, alias ID, deployed richMenuId, and switch diagnostics.

## Core Features

- Rich Menu editor.
- D1 project library.
- Alias ID field per page.
- Deploy to LINE.
- Save deployed `richMenuId`.
- Create/update LINE alias.
- Keyword rule can invoke a Rich Menu by project, alias, or fallback richMenuId.
- Switch diagnostics records alias status and recent switch events.
- Replacing a background image must preserve existing hot areas and actions.

## Sakura Routes

- `/rich-menu-editor`
- `/line-keyword-rules`
- `/api` actions:
  - `RICH_MENU_LIST`
  - `RICH_MENU_LOAD`
  - `RICH_MENU_SAVE`
  - `RICH_MENU_DELETE`
  - `DEPLOY_RICH_MENU`
  - `RICH_MENU_SWITCH_DIAGNOSE`
  - `RICH_MENU_SWITCH_CHECKS`

## Key Tables

- `rich_menu_projects`
- `rich_menu_switch_checks`

## Required Secrets

- `LINE_CHANNEL_ACCESS_TOKEN`
- `DB`
- `R2_BUCKET`

## Risks

- Alias ID and deployed richMenuId drift.
- LINE client cache makes switching appear delayed.
- Replacing image accidentally clears hot areas.
- Inline editor script syntax can break the whole page.

## Acceptance Checks

- Project saves to D1.
- Project reloads with same image, alias, name, chatBar, and areas.
- Deploy returns a LINE richMenuId.
- Alias points to deployed richMenuId.
- Image replacement preserves existing areas.
- Switch diagnostics can show success/failure.

