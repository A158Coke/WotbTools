-- 给打手档案关联 Keycloak 用户，使 Profile 页面可显示分配单子
ALTER TABLE booster_profile
    ADD COLUMN keycloak_user_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_booster_profile_keycloak_user_id
    ON booster_profile(keycloak_user_id);
