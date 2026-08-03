CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  application_year TEXT,
  academic_year TEXT,
  group_name TEXT,
  student_name TEXT NOT NULL,
  gender TEXT,
  school TEXT,
  grade TEXT,
  department TEXT,
  age TEXT,
  intellect_top TEXT,
  intellect_bottom TEXT,
  moral_top TEXT,
  moral_bottom TEXT,
  talent_organizer TEXT,
  talent_category TEXT,
  talent_result TEXT,
  message_to_sakura TEXT,
  employee_name TEXT,
  relationship TEXT,
  applicant_name TEXT,
  business_unit TEXT,
  employee_dept TEXT,
  employee_id TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  applicant_confirm TEXT,
  confirm_date TEXT,
  agree_terms INTEGER NOT NULL DEFAULT 0,
  photo_url TEXT,
  transcript_url TEXT,
  transcript_urls_json TEXT,
  prelim_status TEXT NOT NULL DEFAULT '待初審',
  final_status TEXT NOT NULL DEFAULT '待複審',
  status TEXT NOT NULL DEFAULT '待初審',
  supplement_note TEXT,
  prelim_reviewer TEXT,
  final_reviewer TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_lookup
ON applications(employee_id, student_name, deleted_at);

CREATE INDEX IF NOT EXISTS idx_applications_status
ON applications(status, prelim_status, final_status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_applications_business_unit
ON applications(business_unit, deleted_at);

CREATE TABLE IF NOT EXISTS reviewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_unit TEXT NOT NULL UNIQUE,
  prelim_reviewer TEXT,
  final_reviewer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO reviewers (business_unit, prelim_reviewer, final_reviewer) VALUES
('總管理處', '', ''),
('製造管理處', '', ''),
('營業管理處', '', ''),
('服務管理處', '', ''),
('品牌/產品管理處', '', ''),
('海外事業處', '', ''),
('廚電事業處', '', ''),
('廚櫃事業處', '', ''),
('櫻花家居', '', ''),
('雅適', '', ''),
('櫻中', '', ''),
('櫻順', '', ''),
('越南子公司台幹', '', ''),
('櫻花總經銷', '', ''),
('廚藝生活館', '', ''),
('太陽能總代理', '', ''),
('其他', '', '');

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT,
  action TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
