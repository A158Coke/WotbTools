-- Referenced public images outlive uploader accounts without retaining their identity.
ALTER TABLE creator_avatar ALTER COLUMN keycloak_subject DROP NOT NULL;
CREATE INDEX creator_avatar_subject_idx ON creator_avatar(keycloak_subject, id);
