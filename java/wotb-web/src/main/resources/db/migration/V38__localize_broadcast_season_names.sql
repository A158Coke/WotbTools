-- Preserve administrator-entered legacy names in both required languages.
ALTER TABLE tournament_broadcast_season RENAME COLUMN name TO name_en;
ALTER TABLE tournament_broadcast_season
    ADD COLUMN name_zh varchar(100),
    ADD COLUMN name_ru varchar(100);
UPDATE tournament_broadcast_season SET name_zh = name_en;
ALTER TABLE tournament_broadcast_season
    ALTER COLUMN name_zh SET NOT NULL,
    ADD CONSTRAINT broadcast_season_name_zh_trimmed CHECK (length(btrim(name_zh)) > 0),
    ADD CONSTRAINT broadcast_season_name_ru_trimmed CHECK (name_ru IS NULL OR (length(btrim(name_ru)) > 0));
