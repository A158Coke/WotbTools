-- V6: 管理员用户删除审计日志。
-- 记录每次管理员删除用户的完整操作轨迹：谁删的、删的谁、结果如何。
CREATE TABLE IF NOT EXISTS admin_user_deletion_log (
    id BIGSERIAL PRIMARY KEY,

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

CREATE INDEX IF NOT EXISTS idx_admin_deletion_log_target_kc_user
    ON admin_user_deletion_log(target_keycloak_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_deletion_log_admin_kc_user
    ON admin_user_deletion_log(admin_keycloak_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_deletion_log_created_at
    ON admin_user_deletion_log(created_at);
