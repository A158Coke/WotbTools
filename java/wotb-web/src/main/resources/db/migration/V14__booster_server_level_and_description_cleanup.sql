-- V14: persist each booster's server, enforce one AVERAGE_GOD per server,
-- and remove legacy application metadata that was copied into editable notes.

ALTER TABLE booster_profile
    ADD COLUMN wotb_server VARCHAR(32) NOT NULL DEFAULT 'CN';

-- An approved application supplies the historical server for otherwise unlinked data.
UPDATE booster_profile bp
SET wotb_server = linked.wotb_server FROM (
    SELECT DISTINCT ON (approved_booster_id)
           approved_booster_id,
           UPPER(BTRIM(wotb_server)) AS wotb_server
    FROM booster_application
    WHERE approved_booster_id IS NOT NULL
      AND UPPER(BTRIM(wotb_server)) IN ('CN', 'ASIA', 'EU', 'NA')
    ORDER BY approved_booster_id, reviewed_at DESC NULLS LAST, id DESC
) linked
WHERE linked.approved_booster_id = bp.id;

-- A currently linked user profile is the final authority and may be newer than the application.
UPDATE booster_profile bp
SET wotb_server = UPPER(BTRIM(up.wotb_server)) FROM user_profile up
WHERE up.keycloak_user_id = bp.keycloak_user_id
  AND UPPER (BTRIM(up.wotb_server)) IN ('CN'
    , 'ASIA'
    , 'EU'
    , 'NA');

ALTER TABLE booster_profile
    ADD CONSTRAINT ck_booster_profile_wotb_server
        CHECK (wotb_server IN ('CN', 'ASIA', 'EU', 'NA'));

CREATE UNIQUE INDEX uq_booster_profile_average_god_server
    ON booster_profile (wotb_server) WHERE level = 'AVERAGE_GOD';

ALTER TABLE booster_profile
    ADD CONSTRAINT ck_booster_profile_level
        CHECK (level IN ('CASUAL', 'SKILLED', 'ELITE', 'PRO', 'MASTER', 'AVERAGE_GOD'));

-- Only clear the exact legacy auto-generated value. Any manually edited note is preserved.
UPDATE booster_profile bp
SET description = NULL,
    updated_at  = NOW() FROM booster_application ba
WHERE ba.approved_booster_id = bp.id
  AND bp.description = CONCAT_WS(E '\n'
    , 'application_id=' || ba.id
    , 'wotb_account_id=' || ba.wotb_account_id
    , 'availability_tier=' || ba.availability_tier
    , 'daily_time_window=' || ba.daily_time_window
    , CASE WHEN BTRIM(COALESCE (ba.wechat
    , '')) <> '' THEN 'wechat=' || ba.wechat END
    , CASE WHEN BTRIM(COALESCE (ba.self_assessment
    , '')) <> ''
    THEN 'self_assessment=' || ba.self_assessment END
    );
