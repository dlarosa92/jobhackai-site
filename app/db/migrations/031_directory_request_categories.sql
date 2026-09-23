-- Additive only. Existing requests are mobile detailing; retain IDs, hashes,
-- statuses and the v1 email payload so in-flight provider retries stay identical.
ALTER TABLE directory_requests ADD COLUMN category TEXT NOT NULL DEFAULT 'mobile-detailing'
  CHECK(category IN ('mobile-detailing','junk-removal','ev-charger-installation'));
ALTER TABLE directory_requests ADD COLUMN notification_format_version INTEGER NOT NULL DEFAULT 1
  CHECK(notification_format_version IN (1,2));
CREATE INDEX directory_requests_category_created ON directory_requests(category, created_at);
