-- One SELECT gives both ledgers and their references the same PostgreSQL MVCC snapshot.
WITH cover_refs AS (
    SELECT r.cover_id, count(*) AS uses, min(c.season_id) AS season_id
    FROM tournament_broadcast_replay r
    JOIN tournament_broadcast_node n ON n.id = r.node_id
    JOIN tournament_broadcast_category c ON c.id = n.category_id
    WHERE r.cover_id IS NOT NULL
    GROUP BY r.cover_id
)
SELECT 'cover' AS namespace, i.id, i.object_key, i.status, i.content_type, i.size, i.hash,
       coalesce(r.uses, 0) AS refs,
       (r.uses IS NULL OR (r.uses = 1 AND r.season_id IS NOT DISTINCT FROM i.season_id)) AS owner_ok,
       CASE WHEN r.uses IS NOT NULL THEN 'BROADCAST' END AS consumer
FROM tournament_broadcast_cover i LEFT JOIN cover_refs r ON r.cover_id = i.id
UNION ALL
SELECT 'avatar', i.id, i.object_key, i.status, i.content_type, i.size, i.hash,
       CASE WHEN c.id IS NULL THEN 0 ELSE 1 END, true, c.type
FROM creator_avatar i LEFT JOIN creator c ON c.avatar_id = i.id
