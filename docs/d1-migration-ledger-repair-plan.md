# D1 Migration Ledger Repair Plan - Sakura Welfare Platform

## Problem

Remote D1 has schema changes that are not recorded in `d1_migrations`.

Observed on 2026-07-16:

- `d1_migrations` stops at `0022_rich_menu_bindings.sql`.
- `0023_vendor_portal_credentials.sql` fails with duplicate column `vendor_portal_username`.
- `welfare_vendors` already contains:
  - `vendor_portal_username`
  - `vendor_portal_password`
  - `vendor_portal_password_updated_at`
- `rich_menu_switch_checks` already exists and matches `0024_rich_menu_switch_checks.sql`.
- `0025_scholarship_privacy_consent.sql` targets `applications`, which is not part of the Sakura welfare core flow and should not be blindly applied during Sakura schema repair.
- `0026_employee_binding_sync.sql` is intentionally no-op because the required `welfare_members` columns were added manually on 2026-07-16 and are protected by runtime schema guards.

## Immediate Risk

Running:

```powershell
npx.cmd wrangler d1 migrations apply sakura-welfare-db --remote -c "D:\OneDrive\文件\New project 5\wrangler.sakura-welfare.toml"
```

will stop at `0023_vendor_portal_credentials.sql` before later migrations can be applied.

## Do Not Do

- Do not delete remote columns to make an old migration pass.
- Do not blindly insert all pending filenames into `d1_migrations`.
- Do not apply scholarship-related migration files as part of Sakura welfare schema work unless the target table and product scope are confirmed.
- Do not run bare `wrangler d1 migrations apply` without `-c "D:\OneDrive\文件\New project 5\wrangler.sakura-welfare.toml"`.

## Safe Repair Sequence

### 1. Backup / Export

Before touching the ledger:

```powershell
cd "D:\OneDrive\文件\New project 5"
npx.cmd wrangler d1 export sakura-welfare-db --remote --output "D:\OneDrive\文件\New project 5\backups\sakura-welfare-db-before-ledger-repair.sql" -c "D:\OneDrive\文件\New project 5\wrangler.sakura-welfare.toml"
```

### 2. Verify Actual Schema

Run:

```powershell
npx.cmd wrangler d1 execute sakura-welfare-db --remote -c "D:\OneDrive\文件\New project 5\wrangler.sakura-welfare.toml" --command "PRAGMA table_info(welfare_vendors); PRAGMA table_info(rich_menu_switch_checks); PRAGMA table_info(welfare_members);"
```

Required proof:

- `welfare_vendors` has all `0023` columns.
- `rich_menu_switch_checks` has all `0024` columns and indexes are not required to be duplicated manually.
- `welfare_members` has employee binding sync columns.

### 3. Decide Per Migration

| Migration | Status | Recommended Action |
| --- | --- | --- |
| `0023_vendor_portal_credentials.sql` | Schema exists, ledger missing | Mark as applied only after backup and schema proof |
| `0024_rich_menu_switch_checks.sql` | Schema exists, ledger missing | Mark as applied only after backup and schema proof |
| `0025_scholarship_privacy_consent.sql` | Product-scope mismatch | Do not apply in Sakura repair until confirmed |
| `0026_employee_binding_sync.sql` | No-op file | Can be marked applied after `0023`/`0024` are reconciled |

### 4. Ledger Repair Requires Explicit Approval

If Tony approves ledger repair, insert only verified migration names into `d1_migrations`.

Do not execute this casually. Use a timestamped note in the work log and keep the D1 export.

## Longer-Term Fix

- Split Sakura-only migrations from unrelated scholarship migrations.
- Avoid duplicate numbering such as `0003_*`, `0004_*`, and `0015_*` in future migration files.
- For every schema change, prefer one verified migration path instead of runtime manual schema changes.
- Keep runtime schema guards only as a compatibility fallback, not as the primary migration mechanism.

## Repair Log

### 2026-07-16

Completed remote D1 ledger repair for `sakura-welfare-db`.

Actions:

- Exported remote D1 backup to `backups/sakura-welfare-db-before-ledger-repair-20260716.sql`.
- Verified `welfare_vendors` already had the `0023_vendor_portal_credentials.sql` columns and index.
- Verified `rich_menu_switch_checks` already had the `0024_rich_menu_switch_checks.sql` table and indexes.
- Inserted `0023_vendor_portal_credentials.sql` and `0024_rich_menu_switch_checks.sql` into `d1_migrations`.
- Moved non-core `0025_scholarship_privacy_consent.sql` to `migrations_quarantined/`.
- Applied `0026_employee_binding_sync.sql` through Wrangler.
- Confirmed `wrangler d1 migrations list sakura-welfare-db --remote -c "D:\OneDrive\文件\New project 5\wrangler.sakura-welfare.toml"` returns `No migrations to apply`.

Current status:

- D1 migration ledger is repaired for Sakura active migrations.
- `0025_scholarship_privacy_consent.sql` remains quarantined and was not applied as part of Sakura welfare schema repair.
