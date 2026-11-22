CREATE TABLE IF NOT EXISTS welfare_vendor_pos_discounts (
  vendor_id TEXT PRIMARY KEY REFERENCES welfare_vendors(id),
  employee_tenths INTEGER NOT NULL CHECK (typeof(employee_tenths) = 'integer' AND employee_tenths BETWEEN 1 AND 99),
  visitor_tenths INTEGER NOT NULL CHECK (typeof(visitor_tenths) = 'integer' AND visitor_tenths BETWEEN 2 AND 100),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (employee_tenths < visitor_tenths)
);
