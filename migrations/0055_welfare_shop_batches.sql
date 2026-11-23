CREATE TABLE welfare_shop_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  ends_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE welfare_shop_products ADD COLUMN batch_id TEXT REFERENCES welfare_shop_batches(id);
CREATE INDEX idx_welfare_shop_products_batch ON welfare_shop_products(batch_id);
