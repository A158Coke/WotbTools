-- Initial source-backed individual matches; no network request runs during migration.
-- Source: docs/research/broadcast-seed-2025-2026/seed-ready.json
-- Source SHA-256 (UTF-8, LF): 65ba1a1934c5012bf51960cc197e1f10fa19c89907d5bd93bd4ef8d3b4638482
-- Facts: official Bilibili BV18j2CBWEMo parts 1-3; official December 5-7 schedule.
-- Generated snapshot of reviewed facts. Corrections after release use administration/new migration.
DO $seed$
DECLARE
    source_rows CONSTANT jsonb := $entries$[
  {
    "server": "CN",
    "year": 2025,
    "season": {
      "nameZh": "战火杯",
      "nameEn": "Zhanhuo Cup",
      "nameRu": null,
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强赛 CHRD VS -ACE-",
      "url": "https://www.bilibili.com/video/BV18j2CBWEMo/?p=1",
      "matchDate": "2025-12-07",
      "dayNumber": 3,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "CHRD",
        "-ACE-"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "CN",
    "year": 2025,
    "season": {
      "nameZh": "战火杯",
      "nameEn": "Zhanhuo Cup",
      "nameRu": null,
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强赛 KSR VS -ACE-",
      "url": "https://www.bilibili.com/video/BV18j2CBWEMo/?p=2",
      "matchDate": "2025-12-07",
      "dayNumber": 3,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "KSR",
        "-ACE-"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "CN",
    "year": 2025,
    "season": {
      "nameZh": "战火杯",
      "nameEn": "Zhanhuo Cup",
      "nameRu": null,
      "startDate": null
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "四强赛 Ru7K1 VS KSR",
      "url": "https://www.bilibili.com/video/BV18j2CBWEMo/?p=3",
      "matchDate": "2025-12-07",
      "dayNumber": 3,
      "groupNumber": 1,
      "bracket": "DEFAULT",
      "teams": [
        "Ru7K1",
        "KSR"
      ],
      "perspective": "OBSERVER"
    }
  }
]$entries$::jsonb;
    item jsonb;
    seed_season_id bigint;
    seed_category_id bigint;
    seed_root_id bigint;
    matched_seasons integer;
    added integer := 0;
BEGIN
    -- Serialize the small one-time seed with normal administrator writes and manual retries.
    LOCK TABLE tournament_broadcast_season IN EXCLUSIVE MODE;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(source_rows) candidate
        WHERE NOT EXISTS (
            SELECT 1 FROM tournament_broadcast_replay existing
            WHERE existing.url ~ '/video/BV18j2CBWEMo([/?#]|$)'
              AND coalesce(substring(existing.url from '[?&]p=([0-9]+)'), '1')
                  = substring(candidate->'replay'->>'url' from '[?&]p=([0-9]+)')
        )
    ) THEN RETURN; END IF;

    SELECT count(*), min(id) INTO matched_seasons, seed_season_id
    FROM tournament_broadcast_season
    WHERE server = 'CN' AND year = 2025
      AND (btrim(name_zh) IN ('战火杯', '2025战火杯', '2025 战火杯')
        OR btrim(name_en) IN ('Zhanhuo Cup', '2025 Zhanhuo Cup', '战火杯', '2025战火杯', '2025 战火杯'));
    IF matched_seasons > 1 THEN
        RAISE WARNING 'Broadcast seed V40 skipped: multiple CN 2025 Zhanhuo Cup seasons require administrator selection';
        RETURN;
    END IF;
    IF matched_seasons = 0 THEN
        INSERT INTO tournament_broadcast_season(server, year, name_zh, name_en, name_ru, start_date, created_at, version)
        VALUES ('CN', 2025, '战火杯', 'Zhanhuo Cup', NULL, NULL, now(), 0) RETURNING id INTO seed_season_id;
    ELSE
        PERFORM id FROM tournament_broadcast_season WHERE id = seed_season_id FOR UPDATE;
    END IF;

    INSERT INTO tournament_broadcast_category(season_id, type) VALUES (seed_season_id, 'SEMI_FINALS')
    ON CONFLICT (season_id, type) DO NOTHING;
    SELECT id INTO seed_category_id FROM tournament_broadcast_category
        WHERE tournament_broadcast_category.season_id = seed_season_id AND type = 'SEMI_FINALS';
    INSERT INTO tournament_broadcast_node(category_id, root_key, round_number, format)
    VALUES (seed_category_id, 0, NULL, NULL) ON CONFLICT (category_id, root_key) DO NOTHING;
    SELECT id INTO seed_root_id FROM tournament_broadcast_node
        WHERE tournament_broadcast_node.category_id = seed_category_id AND root_key = 0;

    FOR item IN SELECT value->'replay' FROM jsonb_array_elements(source_rows) LOOP
        IF EXISTS (
            SELECT 1 FROM tournament_broadcast_replay existing
            WHERE existing.url ~ '/video/BV18j2CBWEMo([/?#]|$)'
              AND coalesce(substring(existing.url from '[?&]p=([0-9]+)'), '1')
                  = substring(item->>'url' from '[?&]p=([0-9]+)')
        ) THEN CONTINUE; END IF;
        INSERT INTO tournament_broadcast_replay(node_id, title, url, match_date, day_number,
                group_number, bracket, teams, perspective, cover_id, created_at)
        VALUES (seed_root_id, item->>'title', item->>'url', (item->>'matchDate')::date,
                (item->>'dayNumber')::integer, (item->>'groupNumber')::integer,
                item->>'bracket', item->'teams', item->>'perspective', NULL, now());
        added := added + 1;
    END LOOP;
    IF added > 0 THEN
        UPDATE tournament_broadcast_season SET version = version + 1 WHERE id = seed_season_id;
    END IF;
END $seed$;
