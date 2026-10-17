-- Apply once to the existing dashboard D1 database before deploying the new Worker.
ALTER TABLE campaign_items ADD COLUMN impact TEXT NOT NULL DEFAULT 'campaign' CHECK (impact IN ('customer', 'prospect', 'campaign'));
ALTER TABLE campaign_items ADD COLUMN next_action TEXT NOT NULL DEFAULT '';
