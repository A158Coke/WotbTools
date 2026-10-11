ALTER TABLE user_profile
    ADD COLUMN onboarding_core_epoch INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN onboarding_disposition VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD CONSTRAINT ck_user_profile_onboarding_receipt CHECK (
        (onboarding_core_epoch = 0 AND onboarding_disposition = 'NONE')
        OR (onboarding_core_epoch >= 1 AND onboarding_disposition IN ('COMPLETED', 'SKIPPED'))
    );
