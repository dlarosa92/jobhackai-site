-- Cadence changes only reconciliation. Keep all run receipts and their original ownership.
UPDATE workflow_policies SET max_age_minutes=45 WHERE id='reconciliation';
