ALTER TABLE line_webhook_events ADD COLUMN ai_summary TEXT;
ALTER TABLE line_webhook_events ADD COLUMN ai_severity TEXT;
ALTER TABLE line_webhook_events ADD COLUMN ai_reason TEXT;
ALTER TABLE line_webhook_events ADD COLUMN ai_reply_suggestion TEXT;
ALTER TABLE line_webhook_events ADD COLUMN ai_analysis_json TEXT;
