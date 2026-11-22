ALTER TABLE welfare_vendors
ADD COLUMN is_current_featured INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_welfare_vendors_current_featured
ON welfare_vendors(is_current_featured, status, is_hidden);
