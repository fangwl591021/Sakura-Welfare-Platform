-- Additive indexes only; preserve registrations and historical audit rows.
CREATE INDEX IF NOT EXISTS idx_activity_registration_owner_created ON welfare_activity_registrations(line_user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_welfare_audit_actor_type_created ON welfare_audit_events(actor_id,event_type,created_at);
CREATE INDEX IF NOT EXISTS idx_welfare_audit_type_created ON welfare_audit_events(event_type,created_at);
