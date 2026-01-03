-- LinkedIn Optimizer runs (Premium-only MVP)
-- Notes:
-- - Timestamps are epoch milliseconds (INTEGER) to match existing D1 patterns in this repo.
-- - output_json and input_json are stringified JSON blobs; D1 is the source of truth.
-- - is_pinned reserved for future "pin" feature; retention should never delete pinned runs.

CREATE TABLE IF NOT EXISTS linkedin_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  role TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing', -- ok|processing|error
  overall_score INTEGER,
  input_json TEXT NOT NULL,
  output_json TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  error_message TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_created
ON linkedin_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_runs_user_hash
ON linkedin_runs(user_id, input_hash);

