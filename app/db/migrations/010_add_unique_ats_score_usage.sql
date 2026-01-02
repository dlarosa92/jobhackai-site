-- Migration: Enforce unique free ATS score usage per user
-- This migration creates a unique index to only allow a single free ATS score event per user

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_user_feature_unique ON usage_events(user_id, feature) WHERE feature = 'ats_score';

