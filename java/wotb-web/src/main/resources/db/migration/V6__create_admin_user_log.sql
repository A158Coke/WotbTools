-- V6: 管理员操作日志。
-- 记录管理员对用户的所有操作（删除用户等），谁做的、对谁做的、结果如何。
CREATE TABLE IF NOT EXISTS admin_user_log (
    id BIGSERIAL PRIMARY KEY,

    operation VARCHAR(32) NOT NULL DEFAULT 'DELETE_USER',

    target_keycloak_user_id VARCHAR(64) NOT NULL,
    target_profile_id BIGINT,
    target_display_name VARCHAR(64),
    target_wotb_account_id BIGINT,
    target_wotb_nickname VARCHAR(64),
    target_wotb_server VARCHAR(32),

    admin_keycloak_user_id VARCHAR(64) NOT NULL,
    admin_username VARCHAR(128),

    status VARCHAR(32) NOT NULL,

    local_profile_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    keycloak_user_deleted BOOLEAN NOT NULL DEFAULT FALSE,

    error_code VARCHAR(64),
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_user_log_operation
    ON admin_user_log(operation);

CREATE INDEX IF NOT EXISTS idx_admin_user_log_target_kc_user
    ON admin_user_log(target_keycloak_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_user_log_admin_kc_user
    ON admin_user_log(admin_keycloak_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_user_log_created_at
    ON admin_user_log(created_at);
