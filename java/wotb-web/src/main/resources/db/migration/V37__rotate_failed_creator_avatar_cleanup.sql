ALTER TABLE creator_avatar ADD COLUMN last_cleanup_attempt_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX creator_avatar_cleanup_attempt_idx
 ON creator_avatar((coalesce(last_cleanup_attempt_at, unreferenced_at, created_at)), id);
