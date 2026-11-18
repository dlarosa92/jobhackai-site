-- Append-only acknowledgment after inspecting an expired run's native side effects.
-- Original attempts, results and writes remain untouched. Dashboard D1 only.
CREATE TABLE IF NOT EXISTS workflow_recoveries (
  run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id),
  actor TEXT NOT NULL,
  expected_actor TEXT NOT NULL,
  expected_started_at TEXT NOT NULL,
  expected_lease_until TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK(resolution IN ('no_external_action','verified_side_effects')),
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS workflow_recoveries_no_update BEFORE UPDATE ON workflow_recoveries
BEGIN SELECT RAISE(ABORT, 'Workflow recovery evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS workflow_recoveries_no_delete BEFORE DELETE ON workflow_recoveries
BEGIN SELECT RAISE(ABORT, 'Workflow recovery evidence is immutable'); END;
