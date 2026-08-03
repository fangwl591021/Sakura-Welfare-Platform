# KNOWN ISSUES - Sakura Welfare Platform

## KI001 - LIFF Redirect Can Land on Wrong Page

Symptom: LIFF URL opens an unrelated scholarship or root page.

Risk: incorrect endpoint routing or redirect URI mismatch.

Mitigation:

- Check Worker route exists before creating LIFF URL.
- Use explicit path handling.
- Verify through LINE LIFF URL and direct Worker URL.

## KI002 - Inline Script Syntax Breaks Can Blank Whole Pages

Symptom: browser console shows `Unexpected string`, `missing )`, or `Invalid token`.

Risk: large HTML strings inside Worker are fragile.

Mitigation:

- Run `node --check src/index.js`.
- Extract route inline scripts where possible and run syntax checks.
- Keep patches narrow.

## KI003 - Rich Menu Alias Switching Can Lag or Fail

Symptom: menu switch works once, then does not switch back or appears delayed.

Risk: LINE alias cache, D1/LINE alias mismatch, or invalid `richmenuswitch` data.

Mitigation:

- Use D1 Rich Menu projects as the source of truth.
- Fill alias ID clearly in editor.
- Use switch diagnostics table.
- Confirm LINE alias points to the deployed richMenuId.

## KI004 - POS Camera Scanner Depends on LIFF/Permission Context

Symptom: scanner works in one environment but not another.

Risk: LINE in-app browser, browser permission, LIFF scanner API, or HTTPS context mismatch.

Mitigation:

- Follow `docs/vendor-pos-liff-scanner-runbook.md`.
- Vendor login remains account/password.
- Scanner capability should initialize only after vendor POS data loads.

## KI005 - Mother-Site Binding Result Is Not Fully Machine-Readable

Symptom: user appears to complete binding, but child site cannot reliably know final status.

Risk: employee menu and member pages may not know whether a user is verified.

Mitigation:

- Prefer a mother-site callback/query endpoint returning clear binding status.

- Once a reliable result is available, store a child-site synchronized identity state and use that for Sakura Rich Menu/page access decisions.

## KI006 - D1 Count and Visible List Can Diverge

Symptom: sidebar count says 4, table shows 3.

Risk: hidden, soft-deleted, incomplete, status-filtered, or duplicate records.

Mitigation:

- Align count query with visible list query.
- Display filters and hidden status clearly.
- Use soft-delete/hide state consistently.

## KI007 - Vendor Duplicate Applications

Symptom: vendor submits multiple applications with same LINE user or account.

Risk: inconsistent review data and confusion.

Mitigation:

- Lock first-time application button after confirmed submit.
- Existing application should reopen edit/status instead of blank new form.
- Use vendor username, LINE user ID, phone, and normalized company name checks. Code now checks visible records by vendor portal username, submitted/contact LINE UID, tax ID, phone+name, and phone+contact before creating a new application (2026-07-16).

## KI008 - AI OCR/Menu Extraction Is Not Production-Ready

Symptom: uploaded DM produces incomplete text-only content.

Risk: poor vendor presentation and incorrect product content.

Mitigation:

- Keep menu/DM generation hidden until extraction, image preservation, progress percentage, completion notice, and review workflow are stable.

## KI009 - Public Store and Medical Listings Can Miss Newly Added Vendors

Symptom: approved vendor or medical provider does not appear in public LIFF page.

Risk: category/status/region filter mismatch.

Mitigation:

- Check category value, approval status, hidden flag, language route, and listing query.

## KI010 - Webhook Reply Ownership Must Stay Explicit

Symptom: mother-site keyword works inconsistently or child site does not respond.

Risk: duplicate replyToken use, forwarding order, or child route swallowing mother-site keyword.

Mitigation:

- Keep mother-site keyword responsibilities documented.
- Child site should record and support without breaking existing mother-site reply functions.

## KI011 - D1 Migration Ledger Drift (Repaired 2026-07-16)

Symptom: `wrangler d1 migrations apply` fails at `0023_vendor_portal_credentials.sql` with duplicate `vendor_portal_username`, although the columns already exist in remote D1.

Risk: future migration runs stop before later migrations, even when the live schema already contains part of the expected structure.

Mitigation:

- Repaired on 2026-07-16 after remote backup and schema verification.
- Active migrations now return `No migrations to apply`.
- `0025_scholarship_privacy_consent.sql` is quarantined in `migrations_quarantined/` and was not applied as part of Sakura welfare schema repair.
- Continue verifying live schema with `PRAGMA table_info(...)` before future manual ledger changes.

## KI012 - Feature Boundary Drift

Symptom: a new LINE, LIFF, vendor, member, or admin feature works in one route but creates inconsistent identity, permission, or audit behavior elsewhere.

Risk: provider-specific logic becomes business logic; Sakura-specific behavior leaks into reusable framework thinking; future routes duplicate or bypass existing checks.

Mitigation:

- Use `docs/feature-classification-gate.md` before coding new features.
- Use `docs/identity-and-permission-model.md` for role and access decisions.
- Use `docs/transaction-safety-checklist.md` for state-changing actions.

## KI013 - Approved Vendor State Can Drift From LINE Vendor Session

Symptom: admin review shows a vendor as approved, but LINE OA `廠商專區` replies that the LINE account is not bound to an approved vendor.

Risk: `welfare_vendor_line_sessions` may contain an old vendor mapping, or a non-LINE value such as a phone number may have been stored in a LINE UID field.

Mitigation:

- Treat `welfare_vendors` as the authority for vendor approval and valid vendor LINE UID fields.
- Treat `welfare_vendor_line_sessions` as a repairable cache only.
- On approval, refresh the LINE session when a valid LINE UID exists.
- When handling `廠商專區`, prefer a direct approved vendor master match over stale session rows.
- Do not accept phone numbers or other non-`U...` values as LINE User IDs.
## KI014 - Vendor POS LINE WebView Session Drift

Symptom: vendor opens `廠商專區` from LINE, taps POS workbench, and is asked to log in again even after prior successful login.

Risk: LINE WebView cookie, localStorage, sessionStorage, and stale Flex card URLs are not stable enough to be the only POS login bridge.

Mitigation:

- Follow `docs/vendor-portal-pos-session-runbook.md` before editing vendor portal, vendor login, POS, or `廠商專區` Flex buttons.
- `廠商專區` POS button should prefer a direct `/vendor-pos?vendor_id=...&portal_token=...` LIFF URL.
- `/vendor-pos`, `/vendor-login`, and `/vendor-portal` should remain `Cache-Control: no-store, no-cache, must-revalidate`.
- After changes, test with a newly generated LINE Flex card, not an old message.

