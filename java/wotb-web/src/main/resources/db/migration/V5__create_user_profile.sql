-- V5: WotBTools 业务用户资料表。
-- Keycloak 负责认证/权限，user_profile 负责轻量业务资料。
CREATE TABLE user_profile (
    id BIGSERIAL PRIMARY KEY,

    keycloak_user_id VARCHAR(64) NOT NULL UNIQUE,

    display_name VARCHAR(64),

    wotb_account_id BIGINT,
    wotb_nickname VARCHAR(64),
    wotb_server VARCHAR(32) NOT NULL DEFAULT 'CN',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uk_user_profile_wotb_account
        UNIQUE (wotb_server, wotb_account_id),

    CONSTRAINT ck_user_profile_wotb_server
        CHECK (wotb_server IN ('CN'))
);
