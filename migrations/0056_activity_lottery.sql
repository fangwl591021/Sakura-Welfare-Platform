CREATE TABLE IF NOT EXISTS welfare_activity_lotteries (
  event_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state_json TEXT NOT NULL CHECK (json_valid(state_json))
);
