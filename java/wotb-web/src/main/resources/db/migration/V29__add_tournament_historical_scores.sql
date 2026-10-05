-- Historical leaderboards contain direct scores without authoritative group/rank data.
ALTER TABLE tournament_day ADD COLUMN published_historical_points JSONB;
ALTER TABLE tournament_day ADD CONSTRAINT tournament_day_single_published_source
 CHECK (published_groups IS NULL OR published_historical_points IS NULL);
ALTER TABLE tournament_day ADD CONSTRAINT tournament_day_historical_points_object
 CHECK (published_historical_points IS NULL OR jsonb_typeof(published_historical_points) = 'object');
ALTER TABLE tournament_clan ADD COLUMN historical_published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournament_event ADD COLUMN historical_import_key VARCHAR(64);
ALTER TABLE tournament_event ADD COLUMN historical_import_hash VARCHAR(64);
ALTER TABLE tournament_event ADD CONSTRAINT tournament_event_historical_import_identity
 CHECK ((historical_import_key IS NULL AND historical_import_hash IS NULL)
   OR (historical_import_key IS NOT NULL AND historical_import_hash IS NOT NULL
     AND historical_import_hash ~ '^[a-f0-9]{64}$'));
