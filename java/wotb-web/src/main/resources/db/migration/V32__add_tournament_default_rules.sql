-- Permanent singleton: serializes replacement even while inactive.
CREATE TABLE tournament_default_rules (
 id BIGINT PRIMARY KEY CHECK (id = 1),
 version BIGINT NOT NULL CHECK (version >= 0),
 active BOOLEAN NOT NULL,
 source_event_id BIGINT REFERENCES tournament_event(id) ON DELETE SET NULL,
 source_label VARCHAR(100) NOT NULL,
 updated_at TIMESTAMP WITH TIME ZONE,
 rounds JSONB NOT NULL CHECK (jsonb_typeof(rounds) = 'array')
);
ALTER TABLE tournament_event ADD COLUMN rule_source VARCHAR(16) NOT NULL DEFAULT 'INHERIT'
 CHECK (rule_source IN ('INHERIT','CUSTOM','FROZEN'));
ALTER TABLE tournament_event ADD COLUMN frozen_default_version BIGINT;
-- Freeze existing started events without changing any rule or published score.
UPDATE tournament_event e SET rule_source = CASE
 WHEN e.config_locked OR e.historical_import_key IS NOT NULL OR EXISTS (
   SELECT 1 FROM tournament_day d WHERE d.event_id = e.id AND
    (d.expected_group_count IS NOT NULL OR d.draft_groups IS NOT NULL OR d.published_groups IS NOT NULL
     OR d.published_historical_points IS NOT NULL OR d.correction)) THEN 'FROZEN'
 WHEN EXISTS (SELECT 1 FROM tournament_rule r CROSS JOIN LATERAL jsonb_array_elements(r.days) d
   WHERE r.event_id = e.id AND jsonb_array_length(COALESCE(d->'points','[]'::jsonb)) > 0) THEN 'CUSTOM'
 ELSE 'INHERIT' END;
-- Global audit rows have no event FK, so source-event deletion cannot erase them.
ALTER TABLE tournament_audit ALTER COLUMN event_id DROP NOT NULL;
-- User-approved 2026 FIRE_CUP: group stage then finals, ranks 1-4; no invented fifth rank.
INSERT INTO tournament_default_rules (id, version, active, source_event_id, source_label, updated_at, rounds)
VALUES (1, 1, TRUE, NULL, '2026 FIRE_CUP', CURRENT_TIMESTAMP, '[{"roundNumber":1,"days":[{"dayNumber":1,"points":[{"rank":1,"points":2305},{"rank":2,"points":1153},{"rank":3,"points":577},{"rank":4,"points":289}]},{"dayNumber":2,"points":[{"rank":1,"points":1845},{"rank":2,"points":1291},{"rank":3,"points":903},{"rank":4,"points":631}]}]},{"roundNumber":2,"days":[{"dayNumber":1,"points":[{"rank":1,"points":2813},{"rank":2,"points":1756},{"rank":3,"points":879},{"rank":4,"points":440}]},{"dayNumber":2,"points":[{"rank":1,"points":2253},{"rank":2,"points":1575},{"rank":3,"points":1101},{"rank":4,"points":771}]}]},{"roundNumber":3,"days":[{"dayNumber":1,"points":[{"rank":1,"points":3767},{"rank":2,"points":2173},{"rank":3,"points":1139},{"rank":4,"points":667}]},{"dayNumber":2,"points":[{"rank":1,"points":3013},{"rank":2,"points":2109},{"rank":3,"points":1477},{"rank":4,"points":1033}]}]},{"roundNumber":4,"days":[{"dayNumber":1,"points":[{"rank":1,"points":4937},{"rank":2,"points":3315},{"rank":3,"points":2038},{"rank":4,"points":1020}]},{"dayNumber":2,"points":[{"rank":1,"points":3949},{"rank":2,"points":2765},{"rank":3,"points":1935},{"rank":4,"points":1355}]}]},{"roundNumber":5,"days":[{"dayNumber":1,"points":[{"rank":1,"points":6611},{"rank":2,"points":4439},{"rank":3,"points":4155},{"rank":4,"points":1367}]},{"dayNumber":2,"points":[{"rank":1,"points":5287},{"rank":2,"points":3703},{"rank":3,"points":2591},{"rank":4,"points":1815}]}]}]'::jsonb);
INSERT INTO tournament_audit (event_id, action, actor, created_at, before_state, after_state)
SELECT NULL, 'DEFAULT_RULES_INITIALIZED', 'flyway:V32', CURRENT_TIMESTAMP, '{}'::jsonb,
 jsonb_build_object('defaultRules', jsonb_build_object('version', version, 'active', active,
 'sourceEventId', source_event_id, 'sourceLabel', source_label, 'updatedAt', updated_at, 'rounds', rounds))
FROM tournament_default_rules WHERE id = 1;
