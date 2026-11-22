-- Child-site display roster only. Binding identity remains in welfare_members.
-- No member creation, birthday, LINE UID, entitlement or permission data.
CREATE TABLE IF NOT EXISTS employee_roster (
  employee_no TEXT PRIMARY KEY NOT NULL,
  employee_name TEXT NOT NULL DEFAULT '',
  factory TEXT NOT NULL DEFAULT '',
  business_unit TEXT NOT NULL DEFAULT '',
  department_code TEXT NOT NULL DEFAULT '',
  department_name TEXT NOT NULL DEFAULT '',
  identity_type TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  source_sheet TEXT NOT NULL DEFAULT '',
  source_row INTEGER NOT NULL DEFAULT 0,
  source_sha256 TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
);
