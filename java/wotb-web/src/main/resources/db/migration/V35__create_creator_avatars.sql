CREATE TABLE creator_avatar (
 id VARCHAR(36) PRIMARY KEY,
 keycloak_subject VARCHAR(64) NOT NULL CHECK (length(btrim(keycloak_subject)) > 0),
 object_key VARCHAR(512) NOT NULL UNIQUE,
 status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'READY')),
 content_type VARCHAR(32) NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
 size BIGINT NOT NULL CHECK (size > 0 AND size <= 10485760),
 hash VARCHAR(64) NOT NULL,
 created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 unreferenced_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX creator_avatar_cleanup_idx ON creator_avatar((coalesce(unreferenced_at, created_at)), id);
ALTER TABLE creator ADD COLUMN avatar_id VARCHAR(36) UNIQUE REFERENCES creator_avatar(id);
