# PROJECT STATUS - Sakura Welfare Platform

## Snapshot

Date: 2026-07-10

Current implementation is a Cloudflare Worker based platform with D1, R2, LINE OA webhook handling, vendor flows, LIFF pages, Rich Menu tools, and admin surfaces.

## Completed / Working

- Cloudflare Worker deployment using `wrangler.sakura-welfare.toml`.
- LINE dual webhook route with mother-site forwarding contract.
- D1 bindings for Sakura platform data.
- R2 binding for uploaded files and media.
- Admin backend route `/sakura-admin`.
- LINE OA monitor with D1 message storage and AI-assisted classification concepts.
- Rich Menu editor with D1 project storage, alias field, deployment flow, switch diagnostics, and visitor-only global default guard.
- CRM Rich Menu status distinguishes LINE-verified current menu from command-sent/unverified switch records.
- Employee binding Rich Menu rules now map deployed three-language menus: 繁中 `twmem-menu`, 印尼文 `indo-menu`, and 泰文 `taimem-menu`.
- CRM user list can trigger a child-side mother roster reconciliation sync for rows that already have LINE UID and employee number.
- Rich Menu image replacement now preserves existing hot areas and actions.
- Keyword rules page for LINE OA automation, including Rich Menu invocation.
- Vendor application page with basic data, license/document area, and offer content area.
- Vendor review in admin backend with approve/return/suspend/hide actions.
- Vendor approval now repairs LINE OA vendor session cache from the approved vendor master, preventing approved vendors from seeing not-bound/not-approved messages in `廠商專區`.
- Vendor account/password login as primary vendor access.
- Vendor portal route and vendor micro-site route.
- Vendor POS route with LIFF scanner support and account/password login.
- POS redemption records with original amount, payable amount, discount, vendor, member, and optional notes.
- Member records page with consumption record concept and activity record tab.
- Activity check-in admin and member calendar concept.
- Medical providers and partner store public list pages with language variants.
- UID whitelist and admin permission concept.
- AI knowledge-base upload area concept.

- Identity and permission model documented in docs/identity-and-permission-model.md.
- Transaction safety checklist documented in docs/transaction-safety-checklist.md.

## Partially Complete / Needs Hardening


- Identity and permission boundaries must be checked before adding routes that depend on visitor, employee, vendor, admin, or manager roles.
- State-changing actions must define idempotency, audit, stored result, and correction path before production use.
- Mother-site point read/write integration exists as documented API contract but must be validated end to end per action.
- Vendor edit approval workflow needs consistent review records for every public-facing modification.
- POS scanner works only under correct LIFF / browser permission conditions; runbook must remain mandatory.
- Member consumption query should stay simple and avoid exposing UID or internal source labels.
- Activity calendar needs continued UI validation for month navigation, collapsible calendar state, and audience categories.
- Rich Menu switching has diagnostics, but actual LINE client behavior must be periodically tested because alias and cache behavior can lag.
- Medical provider and partner store listing data must be checked after every vendor/category change.
- Mother roster reconciliation depends on mother API key configuration and live mother API response shape.
- Telegram notification parameters and alert rules need a final settings surface.
- AI OCR/menu-DM generation is deferred to a later phase and should remain hidden from main vendor workflow until stable.
- GitHub Actions now verifies every pull request and main push; production deployment remains a separate manual workflow and never applies D1 migrations.

## Known High-Risk Areas

- Inline HTML scripts inside `src/index.js` are fragile. Always run `node --check src/index.js` and route-specific inline script checks after editing.
- `wrangler.toml` and `wrangler.sakura-welfare.toml` are different surfaces. Sakura deployment must use `wrangler.sakura-welfare.toml`.
- LIFF redirect URLs can easily fall back to unrelated pages if endpoint paths are not explicitly handled.
- LINE camera scanning requires LIFF scanner flow or secure browser permission. Plain page assumptions are unsafe.
- Mother-site webhook and child-site webhook must not both consume `replyToken` incorrectly.
- D1 counts and visible list filters can diverge if soft-hidden, status-filtered, or incomplete records are counted differently.
- D1 migration ledger repaired on 2026-07-16; active migrations now report no pending items. Non-core 0025 scholarship migration is quarantined.

## Current Recommended Verification

- Syntax: `node --check src/index.js`.
- Deploy: `npx.cmd wrangler deploy -c wrangler.sakura-welfare.toml`.
- Live route checks:
  - `/sakura-admin`
  - `/line-webhook`
  - `/line-oa-monitor`
  - `/rich-menu-editor`
  - `/vendor-apply`
  - `/vendor-login`
  - `/vendor-pos?vendor_id=...`
  - `/vendor-store?vendor_id=...`
  - `/member-records`
  - `/activity-checkin-admin`










