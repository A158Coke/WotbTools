-- Retain original administrator labels for manual recovery when not unambiguously numeric.
ALTER TABLE tournament_broadcast_replay RENAME COLUMN group_label TO legacy_group_label;
ALTER TABLE tournament_broadcast_replay
    DROP CONSTRAINT tournament_broadcast_replay_group_number_check,
    ADD CONSTRAINT tournament_broadcast_replay_group_number_positive CHECK (group_number > 0);

WITH numeric_labels AS (
    SELECT replay.id, CASE
        WHEN btrim(replay.legacy_group_label) ~ '^[0-9]+$'
            THEN btrim(replay.legacy_group_label)
        WHEN btrim(replay.legacy_group_label) ~* '^Group[[:space:]]+[0-9]+$'
            THEN regexp_replace(btrim(replay.legacy_group_label), '^Group[[:space:]]+', '', 'i')
        WHEN btrim(replay.legacy_group_label) ~ '^第[[:space:]]*[0-9]+[[:space:]]*组$'
            THEN regexp_replace(replay.legacy_group_label, '[^0-9]', '', 'g')
        END AS digits
    FROM tournament_broadcast_replay replay
    JOIN tournament_broadcast_node node ON node.id = replay.node_id
    JOIN tournament_broadcast_category category ON category.id = node.category_id
    WHERE category.type = 'POINTS' AND replay.group_number IS NULL
)
UPDATE tournament_broadcast_replay replay
SET group_number = CASE WHEN numeric_labels.digits::numeric BETWEEN 1 AND 2147483647
    THEN numeric_labels.digits::numeric::integer END
FROM numeric_labels
WHERE replay.id = numeric_labels.id;
