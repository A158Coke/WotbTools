-- Approved final screenshot: 2026 CN Summer, first 32 clans only (316 scores, 4 omissions).
-- A single atomic statement also permits manual execution; Flyway records it once as V30.
-- Keep the source facts immutable. Later corrections use tournament administration.
DO $seed$
DECLARE
    source_name CONSTANT TEXT := '2026 国服夏季赛最终榜（32强）';
    source_sha256 CONSTANT TEXT := '171b9618ea53ef585c200a4248704d43ab00e6d166b47d2003cd80764140bfd4';
    import_key CONSTANT TEXT := 'flyway-v30:2026-cn-summer-top32';
    -- Same canonical request hash as TournamentService; verified by an actual API-service retry.
    import_hash CONSTANT TEXT := '2e8ef8bcd8c3a69dfd350e5701d394ac5fd5eb75a72cef55c580b7a8ad4a93f3';
    source_rows CONSTANT JSONB := $rows$[
    {"clanTag":"KSR","points":[2305,1845,2813,2253,3767,3013,4937,3949,6611,5287],"sourceTotal":36780},
    {"clanTag":"CHRD","points":[2305,1845,2813,2253,3767,3013,4937,3949,6611,5287],"sourceTotal":36780},
    {"clanTag":"-TOP-","points":[2305,1845,2813,2253,3767,3013,4937,3949,6611,5287],"sourceTotal":36780},
    {"clanTag":"ALON3","points":[2305,1845,2813,1575,3767,3013,4937,3949,6611,5287],"sourceTotal":36102},
    {"clanTag":"G7","points":[2305,1845,2813,1575,3767,3013,4937,3949,6611,5287],"sourceTotal":36102},
    {"clanTag":"25时","points":[2305,1845,2813,1575,3767,3013,4937,3949,6611,5287],"sourceTotal":36102},
    {"clanTag":"-W-","points":[2305,1845,2813,2253,3767,2109,4937,3949,6611,5287],"sourceTotal":35876},
    {"clanTag":"UC浏览器","points":[2305,1845,2813,2253,3767,3013,4937,2765,6611,5287],"sourceTotal":35596},
    {"clanTag":"雷霆大嘴","points":[2305,1845,2813,2253,2173,3013,4937,3949,6611,5287],"sourceTotal":35186},
    {"clanTag":"URS","points":[2305,1291,1756,2253,3767,3013,4937,3949,6611,5287],"sourceTotal":35169},
    {"clanTag":"NAVI","points":[2305,1291,2813,2253,3767,3013,4937,2765,6611,5287],"sourceTotal":35042},
    {"clanTag":"动物城","points":[2305,1845,2813,2253,3767,3013,4937,1935,6611,5287],"sourceTotal":34766},
    {"clanTag":"-PRS-","points":[2305,1291,2813,2253,3767,3013,4937,3949,6611,3703],"sourceTotal":34642},
    {"clanTag":"^_^","points":[2305,1845,2813,1575,3767,1477,4937,3949,6611,5287],"sourceTotal":34566},
    {"clanTag":"-GOD-","points":[2305,903,2813,2253,3767,3013,4937,3949,4439,5287],"sourceTotal":33666},
    {"clanTag":"-IE-","points":[2305,1845,1756,2253,3767,3013,4937,3949,4439,5287],"sourceTotal":33551},
    {"clanTag":"-LGD-","points":[2305,1845,1756,1575,3767,3013,3315,3949,6611,5287],"sourceTotal":33423},
    {"clanTag":"非比啾比","points":[2305,903,2813,2253,2173,3013,4937,3949,6611,3703],"sourceTotal":32660},
    {"clanTag":"BPR","points":[2305,1291,2813,1101,2173,3013,4937,2765,6611,5287],"sourceTotal":32296},
    {"clanTag":"-VC-","points":[2305,903,2813,2253,2173,2109,4937,2765,6611,5287],"sourceTotal":32156},
    {"clanTag":"-VCG-","points":[2305,1291,2813,1575,2173,2109,4937,2765,6611,5287],"sourceTotal":31866},
    {"clanTag":"ROSA","points":[577,null,1756,1575,3767,3013,4937,3949,6611,5287],"sourceTotal":31472},
    {"clanTag":"MEIKO","points":[1153,1291,2813,1575,3767,2109,4937,3949,6611,1815],"sourceTotal":30020},
    {"clanTag":"宝宝别打我","points":[1153,1291,2813,2253,3767,2109,4937,2765,6611,1815],"sourceTotal":29514},
    {"clanTag":"AYDR","points":[2305,631,2813,1575,3767,1477,4937,2765,6611,2591],"sourceTotal":29472},
    {"clanTag":"-FTE-","points":[2305,1845,1756,2253,2173,2109,4937,3949,4439,3703],"sourceTotal":29469},
    {"clanTag":"=白帝城=","points":[2305,1291,2813,1575,3767,2109,3315,1935,6611,3703],"sourceTotal":29424},
    {"clanTag":"=KY1=","points":[2305,631,1756,1575,3767,3013,4937,1935,6611,1815],"sourceTotal":28345},
    {"clanTag":"PHNX","points":[2305,1845,879,null,3767,3013,3315,2765,6611,3703],"sourceTotal":28203},
    {"clanTag":"SESN","points":[1153,1845,1756,1101,3767,3013,3315,1935,6611,3703],"sourceTotal":28199},
    {"clanTag":"UCR","points":[2305,1845,2813,2253,3767,2109,4937,3949,4155,null],"sourceTotal":28133},
    {"clanTag":"送葬者*","points":[577,null,2813,2253,3767,2109,3315,2765,6611,3703],"sourceTotal":27913}
    ]$rows$;
    target tournament_event%ROWTYPE;
    inserted_id BIGINT;
    day_index INTEGER;
    day_scores JSONB;
BEGIN
    IF jsonb_array_length(source_rows) <> 32
       OR (SELECT count(DISTINCT row->>'clanTag') FROM jsonb_array_elements(source_rows) row) <> 32
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(source_rows) row
           WHERE jsonb_array_length(row->'points') <> 10
              OR (SELECT coalesce(sum((point #>> '{}')::BIGINT), 0)
                  FROM jsonb_array_elements(row->'points') point
                  WHERE point <> 'null'::jsonb) <> (row->>'sourceTotal')::BIGINT
       ) THEN
        RAISE EXCEPTION 'V30: invalid approved Summer top-32 source data';
    END IF;

    INSERT INTO tournament_event (year, region, season, round_count, days_per_round, day_labels)
    VALUES (2026, 'CN', 'SUMMER', 5, 2, '["小组赛","决赛圈"]'::jsonb)
    ON CONFLICT (year, region, season) DO NOTHING
    RETURNING id INTO inserted_id;

    SELECT * INTO STRICT target FROM tournament_event
    WHERE year = 2026 AND region = 'CN' AND season = 'SUMMER' FOR UPDATE;

    IF target.historical_import_key = import_key AND target.historical_import_hash = import_hash THEN
        RAISE NOTICE 'V30: approved Summer top-32 batch already committed; leaving current results untouched';
        RETURN;
    END IF;
    IF target.round_count <> 5 OR target.days_per_round <> 2 THEN
        RAISE EXCEPTION 'V30: existing 2026 CN Summer dimensions differ; refusing to overwrite configuration';
    END IF;
    IF target.historical_import_key IS NOT NULL OR EXISTS (
        SELECT 1 FROM tournament_day WHERE event_id = target.id
        AND (draft_groups IS NOT NULL OR published_groups IS NOT NULL
             OR published_historical_points IS NOT NULL OR correction OR cleared_clans <> '[]'::jsonb)
    ) OR EXISTS (SELECT 1 FROM tournament_clan WHERE event_id = target.id AND historical_published) THEN
        RAISE EXCEPTION 'V30: existing 2026 CN Summer has results or drafts; refusing to overwrite data';
    END IF;

    INSERT INTO tournament_rule (event_id, round_number, days)
    SELECT target.id, round_number, '[]'::jsonb FROM generate_series(1, 5) round_number
    ON CONFLICT (event_id, round_number) DO NOTHING;

    INSERT INTO tournament_clan (event_id, clan_tag, historical_published)
    SELECT target.id, row->>'clanTag', true FROM jsonb_array_elements(source_rows) row
    ON CONFLICT (event_id, clan_tag) DO UPDATE SET historical_published = true;

    FOR day_index IN 0..9 LOOP
        SELECT jsonb_object_agg(row->>'clanTag', row->'points'->day_index) INTO day_scores
        FROM jsonb_array_elements(source_rows) row
        WHERE row->'points'->day_index <> 'null'::jsonb;
        IF day_scores IS NOT NULL THEN
            INSERT INTO tournament_day (event_id, round_number, day_number, published_historical_points, version)
            VALUES (target.id, day_index / 2 + 1, day_index % 2 + 1, day_scores, 1)
            ON CONFLICT (event_id, round_number, day_number) DO UPDATE
            SET published_historical_points = EXCLUDED.published_historical_points,
                expected_group_count = NULL, version = tournament_day.version + 1;
        END IF;
    END LOOP;

    UPDATE tournament_event SET config_locked = true, historical_import_key = import_key,
        historical_import_hash = import_hash, version = version + 1 WHERE id = target.id;

    IF inserted_id IS NOT NULL THEN
        INSERT INTO tournament_audit (event_id, action, actor, created_at, before_state, after_state)
        VALUES (target.id, 'CREATE', 'flyway:V30', CURRENT_TIMESTAMP, '{}'::jsonb,
            '{"year":2026,"region":"CN","season":"SUMMER"}'::jsonb);
    END IF;
    INSERT INTO tournament_audit (event_id, action, actor, created_at, before_state, after_state)
    VALUES (target.id, 'HISTORICAL_IMPORTED', 'flyway:V30', CURRENT_TIMESTAMP, '{}'::jsonb,
        jsonb_build_object('sourceName', source_name, 'sourceSha256', source_sha256,
            'importHash', import_hash, 'rows', source_rows, 'clanCount', 32));
END
$seed$;
