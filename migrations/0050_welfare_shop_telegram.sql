CREATE TABLE IF NOT EXISTS welfare_shop_telegram (
  request_id TEXT PRIMARY KEY REFERENCES welfare_shop_requests(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','unknown','disabled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  provider_status INTEGER
);

CREATE INDEX IF NOT EXISTS idx_welfare_shop_telegram_due ON welfare_shop_telegram(status,next_at);
