-- Preserve the browser's explicit staff-validation classification through
-- delayed purchase/refund delivery. This is not authorization or consent.
ALTER TABLE checkout_attributions ADD COLUMN staff_test INTEGER NOT NULL DEFAULT 0 CHECK (staff_test IN (0, 1));
