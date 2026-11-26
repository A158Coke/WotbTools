-- Existing records and configured categories remain UP recommendations.
ALTER TABLE creator ADD COLUMN type VARCHAR(8) NOT NULL DEFAULT 'UP' CHECK (type IN ('UP', 'VIDEO'));
ALTER TABLE creator_category ADD COLUMN type VARCHAR(8) NOT NULL DEFAULT 'UP' CHECK (type IN ('UP', 'VIDEO'));
ALTER TABLE creator DROP CONSTRAINT creator_bilibili_uid_key;
ALTER TABLE creator DROP CONSTRAINT creator_bilibili_uid_check;
ALTER TABLE creator ADD CONSTRAINT creator_type_external_id_unique UNIQUE (type, bilibili_uid);
ALTER TABLE creator ADD CONSTRAINT creator_external_id_check CHECK (
 (type = 'UP' AND bilibili_uid ~ '^[1-9][0-9]{0,19}$') OR
 (type = 'VIDEO' AND bilibili_uid ~ '^BV[A-Za-z0-9]{10}$')
);
ALTER TABLE creator ADD CONSTRAINT creator_video_level_check CHECK (type = 'UP' OR level_id IS NULL);
DROP INDEX creator_public_order_idx;
CREATE INDEX creator_public_order_idx ON creator(type, stars DESC, created_at DESC, id DESC);
CREATE INDEX creator_category_type_idx ON creator_category(type, id);
