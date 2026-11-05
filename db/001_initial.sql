CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL,
 password_hash text NOT NULL, asset_group_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS uploads (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL, name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL,
 width integer NOT NULL, height integer NOT NULL, duration double precision,
 storage_key text NOT NULL, poster_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_user_idx ON uploads(user_id);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, prompt text NOT NULL, config jsonb NOT NULL,
 source_id uuid NOT NULL REFERENCES uploads(id), character_id uuid NOT NULL REFERENCES uploads(id),
 prepared_id uuid REFERENCES uploads(id), frame_id uuid REFERENCES uploads(id), anchor_id uuid REFERENCES uploads(id),
 masked_id uuid REFERENCES uploads(id), result_id uuid REFERENCES uploads(id),
 status text NOT NULL DEFAULT 'queued', stage text NOT NULL DEFAULT 'queued', progress integer NOT NULL DEFAULT 0,
 error text, sam_request_id text, provider_task_id text, asset_id text, asset_group_id text,
 next_run_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_owner text,
 attempts integer NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false,
 submission_started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id)
);
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(next_run_at) WHERE status IN ('queued','processing','generating');
CREATE TABLE IF NOT EXISTS job_events (
 id bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 stage text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (key text NOT NULL, bucket bigint NOT NULL, hits integer NOT NULL DEFAULT 0, PRIMARY KEY(key,bucket));
CREATE TABLE IF NOT EXISTS worker_heartbeats (id text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now());
