WITH open_calls AS (
  SELECT p.*, c.session_id AS control_session_id,
    c.auth_id AS control_owner, c.current_attempt_id, c.deadline_at
  FROM voice_provider_calls p
  LEFT JOIN voice_interview_controls c ON c.session_id = p.session_id
  WHERE p.state <> 'closed'
)
SELECT
  datetime('now') AS observed_at_utc,
  (SELECT COUNT(*) FROM voice_interview_controls) AS recorded_interviews,
  (SELECT COUNT(*) FROM open_calls) AS open_calls,
  (SELECT COUNT(*) FROM open_calls WHERE state = 'uncertain') AS uncertain_calls,
  (SELECT COUNT(*) FROM open_calls
    WHERE state IN ('creating', 'closing')
      AND datetime(updated_at) <= datetime('now', '-5 minutes')) AS stalled_operations,
  (SELECT COUNT(*) FROM open_calls
    WHERE datetime(deadline_at) <= datetime('now', '-2 minutes')) AS overdue_open_calls,
  (SELECT COUNT(*) FROM open_calls
    WHERE control_session_id IS NULL OR control_owner <> auth_id
      OR current_attempt_id IS NULL OR current_attempt_id <> id) AS inconsistent_open_calls,
  (SELECT COUNT(*) FROM open_calls
    WHERE datetime(created_at) IS NULL OR datetime(updated_at) IS NULL
      OR datetime(deadline_at) IS NULL) AS invalid_open_call_timestamps,
  (SELECT COUNT(*) FROM voice_interview_controls
    WHERE legacy_unverified = 1 AND (
      closed_at IS NOT NULL OR datetime(deadline_at) <= datetime('now')
      OR datetime(deadline_at) IS NULL)) AS legacy_calls_awaiting_drain;
