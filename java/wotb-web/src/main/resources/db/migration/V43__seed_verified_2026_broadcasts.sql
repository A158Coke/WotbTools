-- Reviewed 2026 tournament broadcasts; one explicitly confirmed battle pair per stream.
-- Source: docs/research/broadcast-seed-2025-2026/seed-ready-2026.json
-- Source SHA-256 (UTF-8, LF): 30820da36843e72146444b6377d95b5c2b16c55e6ba41f161b66f032e381ac21
-- Source UTC live start is preserved; match_date is the tournament regional calendar date.
-- Confirmed groups are preserved; unknown groups remain NULL. No network access or overwrite of administrator-owned data.
DO $seed$
DECLARE
    source_rows CONSTANT jsonb := $entries$[
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Spring Games",
      "nameEn": "Spring Games",
      "nameRu": null,
      "startDate": "2026-03-02"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 1,
      "format": null
    },
    "replay": {
      "title": "Турнир Spring Games | Путь мастерства #1 | День 4",
      "url": "https://www.youtube.com/watch?v=FXGodwWu1cw",
      "matchDate": "2026-03-05",
      "startsAt": "2026-03-05T18:48:14Z",
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[MERCY] Vaporize",
        "[AQVA] Mono"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Spring Games",
      "nameEn": "Spring Games",
      "nameRu": null,
      "startDate": "2026-03-02"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 2,
      "format": null
    },
    "replay": {
      "title": "Турнир Spring Games | Путь мастерства #2 | День 4",
      "url": "https://www.youtube.com/watch?v=ZcwvTGyUP9M",
      "matchDate": "2026-03-10",
      "startsAt": "2026-03-10T18:44:57Z",
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[LQVID] 67",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Spring Games",
      "nameEn": "Spring Games",
      "nameRu": null,
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "Турнир Spring Games | Турнир Профессионалов | Финальный этап | День 2",
      "url": "https://www.youtube.com/watch?v=_u3nHqOfX5s",
      "matchDate": "2026-03-25",
      "startsAt": "2026-03-25T18:46:00Z",
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "[BLOVE] Bedbug",
        "[MERCY] Vaporize"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Blitz Masters: Legacy",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": null,
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 1,
      "format": null
    },
    "replay": {
      "title": "Турнир Blitz Masters: Legacy | Путь мастерства #1 | День 4",
      "url": "https://www.youtube.com/watch?v=qBqQwnb-CQw",
      "matchDate": "2026-05-13",
      "startsAt": "2026-05-13T17:45:47Z",
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[BLOVE] Bedbug",
        "[EXL] Excellence"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Blitz Masters: Legacy",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": null,
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 2,
      "format": null
    },
    "replay": {
      "title": "Турнир Blitz Masters: Legacy | Путь мастерства #2 | День 4",
      "url": "https://www.youtube.com/watch?v=M6F3kmIxGjg",
      "matchDate": "2026-05-18",
      "startsAt": "2026-05-18T17:45:30Z",
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[-BPS-] Push or Bench",
        "[S-WIL] dep"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Blitz Masters: Legacy",
      "nameEn": "Blitz Masters: Legacy",
      "nameRu": null,
      "startDate": "2026-05-10"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 3,
      "format": null
    },
    "replay": {
      "title": "Турнир Blitz Masters: Legacy | Путь мастерства #3 | День 4",
      "url": "https://www.youtube.com/watch?v=RKA0U8rzXF0",
      "matchDate": "2026-05-24",
      "startsAt": "2026-05-24T17:45:27Z",
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[TORND] TORNADO",
        "[L333T] LEEET ALLIANCE"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Autumn Games",
      "nameEn": "Autumn Games",
      "nameRu": null,
      "startDate": "2026-09-12"
    },
    "categoryType": "POINTS",
    "node": {
      "roundNumber": 3,
      "format": null
    },
    "replay": {
      "title": "Турнир Autumn Games | Путь мастерства #3 | День 4",
      "url": "https://www.youtube.com/watch?v=09LHv_Hk4VI",
      "matchDate": "2026-09-26",
      "startsAt": "2026-09-26T17:49:04Z",
      "dayNumber": 4,
      "groupNumber": null,
      "bracket": null,
      "teams": [
        "[LUV-] LostInNorway",
        "[L333T] LEEEEEEEEEEEEET"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "EU",
    "year": 2026,
    "season": {
      "nameZh": "Autumn Games",
      "nameEn": "Autumn Games",
      "nameRu": null,
      "startDate": "2026-09-12"
    },
    "categoryType": "SEMI_FINALS",
    "node": {
      "roundNumber": null,
      "format": null
    },
    "replay": {
      "title": "Турнир Autumn Games | Финальный этап | День 2",
      "url": "https://www.youtube.com/watch?v=HwtHTRndqCY",
      "matchDate": "2026-10-11",
      "startsAt": "2026-10-11T17:49:09Z",
      "dayNumber": 2,
      "groupNumber": null,
      "bracket": "DEFAULT",
      "teams": [
        "[KOVA-] KOVA",
        "[BLOVE] Bedbug"
      ],
      "perspective": "OBSERVER"
    }
  },
  {
    "server": "ASIA",
    "year": 2026,
    "season": {
      "nameZh": "Spring Games",
      "nameEn": "Spring Games",
      "nameRu": null,
      "startDate": "2026-03-02"
    },
    "categoryType": "SEMI_FINALS",
    "node": { "roundNumber": null, "format": null },
    "replay": {
      "title": "World Of Tanks Blitz || REQM ||  Top4 stage Day 2",
      "url": "https://www.youtube.com/watch?v=reSgKpylUwE",
      "matchDate": "2026-03-25",
      "startsAt": "2026-03-25T11:00:16Z",
      "dayNumber": 2,
      "groupNumber": 1,
      "bracket": "LOSERS",
      "teams": ["REQM", "CHRD"],
      "perspective": "POV"
    }
  }
]$entries$::jsonb;
    existing_videos jsonb;
    event jsonb;
    item jsonb;
    event_video_ids text[];
    video_id text;
    seed_season_id bigint;
    seed_category_id bigint;
    seed_root_id bigint;
    matched_seasons integer;
    existing_owner_matches boolean;
    added integer;
BEGIN
    -- Acquire before row locks, as normal writes lock the season before changing its descendants.
    -- Ordinary readers remain available while the small one-time import runs.
    LOCK TABLE tournament_broadcast_season IN EXCLUSIVE MODE;
    SELECT coalesce(jsonb_agg(jsonb_build_object('videoId', identity.video_id, 'seasonId', season.id,
            'server', season.server, 'year', season.year)), '[]'::jsonb)
    INTO existing_videos
    FROM tournament_broadcast_replay existing
    JOIN tournament_broadcast_node node ON node.id = existing.node_id
    JOIN tournament_broadcast_category category ON category.id = node.category_id
    JOIN tournament_broadcast_season season ON season.id = category.season_id
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN existing.url ~* '^https?://(www\.|m\.)?youtube\.com/watch\?'
                THEN substring(substring(split_part(existing.url, '#', 1) from '^[^?]*\?(.*)$')
                        from '(?:^|&)v=([A-Za-z0-9_-]{11})(?:&|$)')
            WHEN existing.url ~* '^https?://(www\.|m\.)?youtube\.com/live/'
                THEN substring(existing.url from '/live/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
            WHEN existing.url ~* '^https?://(www\.)?youtu\.be/'
                THEN substring(existing.url from '://[^/]+/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
        END AS video_id
    ) identity
    WHERE identity.video_id IS NOT NULL;

    FOR event IN SELECT DISTINCT jsonb_build_object('server', value->'server', 'year', value->'year', 'season', value->'season')
            FROM jsonb_array_elements(source_rows) LOOP
        added := 0;
        SELECT array_agg(substring(candidate->'replay'->>'url' from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)'))
        INTO event_video_ids FROM jsonb_array_elements(source_rows) candidate
        WHERE candidate->'server' = event->'server' AND candidate->'year' = event->'year' AND candidate->'season' = event->'season';

        -- Existing video ownership outranks default names, including renamed administrator seasons.
        SELECT count(DISTINCT (existing->>'seasonId')::bigint), min((existing->>'seasonId')::bigint),
                bool_and(existing->'server' = event->'server' AND existing->'year' = event->'year')
        INTO matched_seasons, seed_season_id, existing_owner_matches
        FROM jsonb_array_elements(existing_videos) existing WHERE existing->>'videoId' = ANY(event_video_ids);
        IF matched_seasons > 1 OR (matched_seasons = 1 AND NOT existing_owner_matches) THEN
            RAISE WARNING 'Broadcast seed V43 skipped event %: conflicting existing video ownership', event->'season'->>'nameEn';
            CONTINUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM unnest(event_video_ids) candidate
                WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(existing_videos) existing WHERE existing->>'videoId' = candidate)) THEN
            CONTINUE;
        END IF;
        IF matched_seasons = 0 THEN
            SELECT count(*), min(id) INTO matched_seasons, seed_season_id
            FROM tournament_broadcast_season
            WHERE server = event->>'server' AND year = (event->>'year')::integer
                AND (btrim(name_zh) = event->'season'->>'nameZh' OR btrim(name_en) = event->'season'->>'nameEn');
        END IF;
        IF matched_seasons > 1 THEN
            RAISE WARNING 'Broadcast seed V43 skipped event %: ambiguous default season names', event->'season'->>'nameEn';
            CONTINUE;
        END IF;
        IF matched_seasons = 0 THEN
            INSERT INTO tournament_broadcast_season(server, year, name_zh, name_en, name_ru, start_date, created_at, version)
            VALUES (event->>'server', (event->>'year')::integer, event->'season'->>'nameZh', event->'season'->>'nameEn',
                    NULL, (event->'season'->>'startDate')::date, now(), 0) RETURNING id INTO seed_season_id;
        ELSE
            PERFORM id FROM tournament_broadcast_season WHERE id = seed_season_id FOR UPDATE;
        END IF;

        FOR item IN SELECT value FROM jsonb_array_elements(source_rows)
                WHERE value->'server' = event->'server' AND value->'year' = event->'year' AND value->'season' = event->'season' LOOP
            video_id := substring(item->'replay'->>'url' from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)');
            IF EXISTS (SELECT 1 FROM jsonb_array_elements(existing_videos) existing WHERE existing->>'videoId' = video_id) THEN CONTINUE; END IF;
            INSERT INTO tournament_broadcast_category(season_id, type) VALUES (seed_season_id, item->>'categoryType')
            ON CONFLICT (season_id, type) DO NOTHING;
            SELECT id INTO seed_category_id FROM tournament_broadcast_category
                WHERE season_id = seed_season_id AND type = item->>'categoryType';
            INSERT INTO tournament_broadcast_node(category_id, root_key, round_number, format)
            VALUES (seed_category_id, coalesce((item->'node'->>'roundNumber')::integer, 0),
                    (item->'node'->>'roundNumber')::integer, item->'node'->>'format')
            ON CONFLICT (category_id, root_key) DO NOTHING;
            SELECT id INTO seed_root_id FROM tournament_broadcast_node
                WHERE category_id = seed_category_id AND root_key = coalesce((item->'node'->>'roundNumber')::integer, 0);
            INSERT INTO tournament_broadcast_replay(node_id, title, url, match_date, match_starts_at, day_number,
                    group_number, bracket, teams, perspective, cover_id, created_at)
            VALUES (seed_root_id, item->'replay'->>'title', item->'replay'->>'url', (item->'replay'->>'matchDate')::date,
                    (item->'replay'->>'startsAt')::timestamptz, (item->'replay'->>'dayNumber')::integer,
                    (item->'replay'->>'groupNumber')::integer, item->'replay'->>'bracket', item->'replay'->'teams', item->'replay'->>'perspective', NULL, now());
            existing_videos := existing_videos || jsonb_build_array(jsonb_build_object('videoId', video_id,
                    'seasonId', seed_season_id, 'server', event->'server', 'year', event->'year'));
            added := added + 1;
        END LOOP;
        IF added > 0 THEN UPDATE tournament_broadcast_season SET version = version + 1 WHERE id = seed_season_id; END IF;
    END LOOP;
END $seed$;
