-- Dashboard only. Execution evidence is separate from editable preparation notes.
CREATE TABLE IF NOT EXISTS work_receipts (
  event_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES work_items(id),
  candidate TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('dev_deployed','dev_verified','qa_deployed','qa_verified','production_deployed','production_verified','published','sent')),
  evidence_url TEXT NOT NULL,
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(item_id,stage)
);
CREATE TABLE IF NOT EXISTS board_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO board_revision VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS board_changed_work_items_insert AFTER INSERT ON work_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_items_update AFTER UPDATE ON work_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_items_delete AFTER DELETE ON work_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_decisions_insert AFTER INSERT ON work_decisions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_decisions_update AFTER UPDATE ON work_decisions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_decisions_delete AFTER DELETE ON work_decisions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_contributions_insert AFTER INSERT ON work_contributions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_contributions_update AFTER UPDATE ON work_contributions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_contributions_delete AFTER DELETE ON work_contributions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_health_insert AFTER INSERT ON source_health
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_health_update AFTER UPDATE ON source_health
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_health_delete AFTER DELETE ON source_health
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_handoffs_insert AFTER INSERT ON work_handoffs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_handoffs_update AFTER UPDATE ON work_handoffs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_handoffs_delete AFTER DELETE ON work_handoffs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_runs_insert AFTER INSERT ON workflow_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_runs_update AFTER UPDATE ON workflow_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_runs_delete AFTER DELETE ON workflow_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_alerts_insert AFTER INSERT ON workflow_alerts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_alerts_update AFTER UPDATE ON workflow_alerts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_alerts_delete AFTER DELETE ON workflow_alerts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_run_writes_insert AFTER INSERT ON workflow_run_writes
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_run_writes_update AFTER UPDATE ON workflow_run_writes
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_workflow_run_writes_delete AFTER DELETE ON workflow_run_writes
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_coordination_runs_insert AFTER INSERT ON coordination_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_coordination_runs_update AFTER UPDATE ON coordination_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_coordination_runs_delete AFTER DELETE ON coordination_runs
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_campaign_items_insert AFTER INSERT ON campaign_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_campaign_items_update AFTER UPDATE ON campaign_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_campaign_items_delete AFTER DELETE ON campaign_items
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_threads_insert AFTER INSERT ON gmail_threads
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_threads_update AFTER UPDATE ON gmail_threads
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_threads_delete AFTER DELETE ON gmail_threads
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_sync_state_insert AFTER INSERT ON gmail_sync_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_sync_state_update AFTER UPDATE ON gmail_sync_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_gmail_sync_state_delete AFTER DELETE ON gmail_sync_state
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_messages_insert AFTER INSERT ON outreach_messages
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_messages_update AFTER UPDATE ON outreach_messages
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_messages_delete AFTER DELETE ON outreach_messages
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_feedback_insert AFTER INSERT ON outreach_feedback
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_feedback_update AFTER UPDATE ON outreach_feedback
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_feedback_delete AFTER DELETE ON outreach_feedback
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_events_insert AFTER INSERT ON outreach_events
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_events_update AFTER UPDATE ON outreach_events
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_outreach_events_delete AFTER DELETE ON outreach_events
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_board_resolutions_insert AFTER INSERT ON board_resolutions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_board_resolutions_update AFTER UPDATE ON board_resolutions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_board_resolutions_delete AFTER DELETE ON board_resolutions
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_cache_insert AFTER INSERT ON source_cache
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_cache_update AFTER UPDATE ON source_cache
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_source_cache_delete AFTER DELETE ON source_cache
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_analytics_reports_insert AFTER INSERT ON analytics_reports
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_analytics_reports_update AFTER UPDATE ON analytics_reports
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_analytics_reports_delete AFTER DELETE ON analytics_reports
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_receipts_insert AFTER INSERT ON work_receipts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_receipts_update AFTER UPDATE ON work_receipts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS board_changed_work_receipts_delete AFTER DELETE ON work_receipts
BEGIN UPDATE board_revision SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON work_receipts
BEGIN SELECT RAISE(ABORT,'Execution receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON work_receipts
BEGIN SELECT RAISE(ABORT,'Execution receipts are immutable'); END;
