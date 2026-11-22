-- Additive, private assets and request-scoped billing reservations only.
CREATE TABLE ai_ads_jobs (
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, id TEXT NOT NULL,
 request_id TEXT NOT NULL, input_hash TEXT NOT NULL, dispatch_nonce TEXT NOT NULL,
 parent_id TEXT, status TEXT NOT NULL CHECK(status IN('DISPATCHED','COMPLETE','FAILED','UNCERTAIN')),
 model TEXT NOT NULL, ratio TEXT NOT NULL, result_asset_id TEXT, error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deadline_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,id), UNIQUE(workspace_id,actor_id,request_id),
 FOREIGN KEY(workspace_id,actor_id,parent_id) REFERENCES ai_ads_jobs(workspace_id,actor_id,id),
 FOREIGN KEY(workspace_id,actor_id,result_asset_id) REFERENCES ai_ads_assets(workspace_id,actor_id,id)
);
CREATE UNIQUE INDEX ai_ads_one_dispatch_per_workspace ON ai_ads_jobs(workspace_id) WHERE status='DISPATCHED';
CREATE INDEX ai_ads_owner_history ON ai_ads_jobs(workspace_id,actor_id,created_at DESC,id DESC);
CREATE TABLE ai_ads_assets (
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, id TEXT NOT NULL,
 job_id TEXT, kind TEXT NOT NULL CHECK(kind IN('reference','generated')), object_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL CHECK(mime_type IN('image/png','image/jpeg','image/webp')), bytes INTEGER NOT NULL,
 width INTEGER NOT NULL, height INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,id), FOREIGN KEY(workspace_id,actor_id,job_id) REFERENCES ai_ads_jobs(workspace_id,actor_id,id)
);
CREATE TABLE ai_ads_usage_reservations (
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, job_id TEXT NOT NULL, day TEXT NOT NULL,
 reserved_micros INTEGER NOT NULL CHECK(reserved_micros>0), state TEXT NOT NULL CHECK(state IN('RESERVED','RELEASED','UNKNOWN')),
 actual_micros INTEGER CHECK(actual_micros IS NULL OR actual_micros>=0), usage_json TEXT,
 provider_request_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,job_id), FOREIGN KEY(workspace_id,actor_id,job_id) REFERENCES ai_ads_jobs(workspace_id,actor_id,id)
);
CREATE INDEX ai_ads_daily_reservations ON ai_ads_usage_reservations(workspace_id,day,state);
