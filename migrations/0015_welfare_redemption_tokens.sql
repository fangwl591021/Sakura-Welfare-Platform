CREATE TABLE IF NOT EXISTS welfare_redemption_tokens (
  token TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL DEFAULT '',
  member_type TEXT NOT NULL DEFAULT 'visitor',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'expired', 'voided')),
  expires_at TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT '',
  used_by_vendor_id TEXT NOT NULL DEFAULT '',
  redemption_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_welfare_redemption_tokens_line_time
  ON welfare_redemption_tokens(line_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_welfare_redemption_tokens_vendor_status
  ON welfare_redemption_tokens(vendor_id, status, expires_at);
