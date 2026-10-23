-- Correct only the unchanged default English name attached to V40's source video.
-- Official NetEase champion poster spells BLITZ PROFESSIONAL CUP 2025 (BPC):
-- https://game.xiaomi.com/viewpoint/1160758920_1766404215796_16
-- V40 and its source manifest remain immutable; administrator names/translations are preserved.
UPDATE tournament_broadcast_season season
SET name_en = 'Blitz Professional Cup (BPC)', version = version + 1
WHERE season.server = 'CN' AND season.year = 2025
  AND season.name_zh = '战火杯' AND season.name_en = 'Zhanhuo Cup'
  AND EXISTS (
      SELECT 1
      FROM tournament_broadcast_category category
      JOIN tournament_broadcast_node node ON node.category_id = category.id
      JOIN tournament_broadcast_replay replay ON replay.node_id = node.id
      WHERE category.season_id = season.id
        AND replay.url ~ '^https?://(www[.])?bilibili[.]com/video/BV18j2CBWEMo([/?#]|$)'
        AND coalesce(substring(replay.url from '[?&]p=([0-9]+)'), '1') IN ('1', '2', '3')
  );
