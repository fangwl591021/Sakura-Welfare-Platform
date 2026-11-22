-- Customer-initiated branch transactions; existing ledger/history remain authoritative.
CREATE TABLE IF NOT EXISTS welfare_branch_redemption_requests (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES welfare_vendors(id),
  location_id TEXT NOT NULL REFERENCES welfare_vendor_locations(id),
  line_user_id TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  vendor_name TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  branch_address TEXT NOT NULL DEFAULT '',
  member_type TEXT NOT NULL CHECK(member_type IN ('employee','visitor')),
  original_price INTEGER NOT NULL CHECK(original_price BETWEEN 1 AND 10000000),
  payable_price INTEGER NOT NULL CHECK(payable_price >= 0 AND payable_price <= original_price),
  discount_amount INTEGER NOT NULL CHECK(discount_amount = original_price - payable_price),
  policy_revision TEXT NOT NULL,
  fold REAL NOT NULL CHECK(fold > 0 AND fold <= 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','rejected','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT '',
  confirmation_key TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  redemption_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_redemption_open_user
  ON welfare_branch_redemption_requests(location_id,line_user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_branch_redemption_vendor_pending
  ON welfare_branch_redemption_requests(vendor_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_branch_redemption_user
  ON welfare_branch_redemption_requests(line_user_id,created_at);
