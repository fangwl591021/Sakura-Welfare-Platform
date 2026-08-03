CREATE TABLE IF NOT EXISTS line_keyword_rules (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',
  action_type TEXT NOT NULL DEFAULT 'reply_text',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  reply_text TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  flex_template_id TEXT NOT NULL DEFAULT '',
  point_type TEXT NOT NULL DEFAULT 'system_point',
  point_amount REAL NOT NULL DEFAULT 0,
  requires_employee INTEGER NOT NULL DEFAULT 0,
  vendor_required INTEGER NOT NULL DEFAULT 0,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_keyword_rules_keyword
  ON line_keyword_rules(keyword, active, priority);

CREATE INDEX IF NOT EXISTS idx_line_keyword_rules_action
  ON line_keyword_rules(action_type, active);

CREATE TABLE IF NOT EXISTS line_keyword_hits (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  action_type TEXT NOT NULL,
  line_user_id TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '',
  source_group_id TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  event_id TEXT NOT NULL DEFAULT '',
  reply_token TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'matched',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_keyword_hits_rule
  ON line_keyword_hits(rule_id, created_at);

CREATE INDEX IF NOT EXISTS idx_line_keyword_hits_user
  ON line_keyword_hits(line_user_id, created_at);

INSERT OR IGNORE INTO line_keyword_rules (
  id, keyword, match_type, action_type, title, description, reply_text, target_url,
  point_type, point_amount, requires_employee, vendor_required, cooldown_seconds,
  priority, active, metadata_json
) VALUES
  (
    'kw_referral_share',
    '分享給好友',
    'exact',
    'referral_link',
    '分享給好友',
    '產生帶有自己 LINE UID 的推薦連結；接受邀約者會登記在推薦人名下。',
    '這是您的專屬分享連結，好友完成加入或註冊後會登記在您的推薦名下。',
    '/referral',
    'system_point',
    0,
    0,
    0,
    0,
    10,
    1,
    '{"referralParam":"ref","linkMode":"liff"}'
  ),
  (
    'kw_daily_checkin',
    '每日打卡取點',
    'exact',
    'daily_checkin_points',
    '每日打卡取點',
    '每日簽到贈點；同一 LINE 使用者依冷卻時間限制一天一次。',
    '今日簽到已收到，系統將依規則贈點。',
    '',
    'system_point',
    1,
    0,
    0,
    86400,
    20,
    1,
    '{"limit":"daily","source":"line_keyword"}'
  ),
  (
    'kw_store_checkin',
    '到店打卡',
    'exact',
    'store_checkin_points',
    '到店打卡',
    '到特約店掃描店家 QR Code 後贈點；需帶店家或地點識別碼。',
    '已收到到店打卡，系統會確認店家 QR Code 後贈點。',
    '',
    'system_point',
    1,
    0,
    1,
    0,
    30,
    1,
    '{"requiresQr":"vendor_location"}'
  );
