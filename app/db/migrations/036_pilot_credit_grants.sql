-- Owner initiated complimentary credits. Apply to app D1 before enabling the
-- dashboard pilot feature. This does not enroll anyone or change any balance.
-- Uses the existing voice credit gate; no Stripe or payment history is changed.
CREATE TABLE IF NOT EXISTS pilot_credit_grants (
  id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('participant','specialist')),
  credits INTEGER NOT NULL CHECK(credits = 60),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  free_session_available INTEGER NOT NULL CHECK(free_session_available IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK(julianday(expires_at) > julianday(starts_at))
);
CREATE INDEX IF NOT EXISTS pilot_credit_grants_cohort ON pilot_credit_grants(cohort_id,role);
