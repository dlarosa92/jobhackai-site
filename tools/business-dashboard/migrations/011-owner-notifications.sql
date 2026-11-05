-- Owner-only operational notices. No contact list, arbitrary-recipient API or send authorization.
CREATE TABLE IF NOT EXISTS owner_notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('brief','failure','recovery')),
  environment TEXT NOT NULL CHECK(environment IN ('dev','qa','prod','unconfigured')),
  subject TEXT NOT NULL CHECK(length(subject)<=160),
  body TEXT NOT NULL CHECK(length(body)<=4000),
  created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','delivered','failed','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  token TEXT,
  provider_id TEXT,
  accepted_at TEXT,
  delivered_at TEXT,
  poll_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_poll_attempts INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT,
  last_reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_notifications_due ON owner_notifications(state,next_attempt_at);
CREATE TRIGGER IF NOT EXISTS owner_notification_content_immutable
BEFORE UPDATE OF id,kind,environment,subject,body,created_at ON owner_notifications
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.environment<>OLD.environment OR NEW.subject<>OLD.subject OR NEW.body<>OLD.body OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'Owner notification content is immutable'); END;
