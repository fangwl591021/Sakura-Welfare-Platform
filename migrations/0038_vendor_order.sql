-- Separate ordering state: existing vendor and location data are untouched.
CREATE TABLE IF NOT EXISTS welfare_vendor_order (vendor_id TEXT PRIMARY KEY, rank INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_welfare_vendor_order_rank ON welfare_vendor_order(rank);
CREATE TABLE IF NOT EXISTS welfare_vendor_order_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, operation_token TEXT NOT NULL DEFAULT '');
INSERT OR IGNORE INTO welfare_vendor_order_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS welfare_vendor_order_actions (request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, vendor_id TEXT NOT NULL, target_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
