PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS line_threads (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL DEFAULT 'line_oa',
  source_user_id TEXT NOT NULL DEFAULT '',
  source_group_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'closed')),
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  assigned_to TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  last_message_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_threads_status
  ON line_threads(status);
CREATE INDEX IF NOT EXISTS idx_line_threads_risk_level
  ON line_threads(risk_level);
CREATE INDEX IF NOT EXISTS idx_line_threads_last_message_at
  ON line_threads(last_message_at);

CREATE TABLE IF NOT EXISTS line_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  line_event_id TEXT NOT NULL DEFAULT '',
  reply_token TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  sender_role TEXT NOT NULL DEFAULT 'user'
    CHECK (sender_role IN ('user', 'guide', 'system')),
  sender_id TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  inserted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES line_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_line_messages_thread_id
  ON line_messages(thread_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_messages_event_id
  ON line_messages(line_event_id)
  WHERE line_event_id <> '';

INSERT OR IGNORE INTO line_threads (
  id, source_type, source_user_id, source_group_id, display_name, picture_url,
  status, risk_level, summary, unread_count, tags, last_message_at, created_at, updated_at
)
SELECT
  'user:' || e.line_user_id,
  'line_oa',
  e.line_user_id,
  '',
  COALESCE(NULLIF(p.display_name, ''), 'LINE ' || substr(e.line_user_id, -6)),
  COALESCE(p.picture_url, ''),
  CASE WHEN e.process_status = 'archived' THEN 'closed' ELSE 'open' END,
  CASE
    WHEN e.priority = 'high' THEN 'high'
    WHEN e.priority = 'medium' THEN 'medium'
    ELSE 'low'
  END,
  COALESCE(NULLIF(e.message_text, ''), '[' || e.message_type || ']'),
  1,
  COALESCE(e.sentiment_type, ''),
  e.created_at,
  e.created_at,
  datetime('now')
FROM line_webhook_events e
LEFT JOIN line_user_profiles p ON p.line_user_id = e.line_user_id
WHERE e.line_user_id IS NOT NULL
  AND e.line_user_id <> ''
GROUP BY e.line_user_id;

INSERT OR IGNORE INTO line_messages (
  id, thread_id, line_event_id, reply_token, message_type, sender_role,
  sender_id, sender_name, message_text, raw_json, created_at
)
SELECT
  'legacy:' || e.id,
  'user:' || e.line_user_id,
  COALESCE(e.event_id, ''),
  '',
  COALESCE(NULLIF(e.message_type, ''), 'text'),
  CASE WHEN e.event_type = 'admin_push' THEN 'guide' ELSE 'user' END,
  e.line_user_id,
  COALESCE(NULLIF(p.display_name, ''), 'LINE ' || substr(e.line_user_id, -6)),
  COALESCE(e.message_text, ''),
  COALESCE(e.raw_payload, ''),
  e.created_at
FROM line_webhook_events e
LEFT JOIN line_user_profiles p ON p.line_user_id = e.line_user_id
WHERE e.line_user_id IS NOT NULL
  AND e.line_user_id <> '';
