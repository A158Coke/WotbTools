-- 排行榜 → 名人堂（Hall of Fame）全技术域 rename（rename-in-place，历史数据原地保留）。
-- 表 / 约束 / 索引重命名；新增 battle_type（业务归一值 RANDOM/RATING，VARCHAR+CHECK，非 PG ENUM）
-- 与 arena_bonus_type（replay 解析出的 authoritative raw integer，protocol provenance/调试/未来扩展）。
-- 历史数据 backfill：battle_type=RANDOM, arena_bonus_type=1。
-- 注意：PR #97 起旧系统允许 Rating(7)，历史行无法逐行推导模式，按产品决策统一 backfill RANDOM/1；
-- 带 replay_hash 的历史行未来可重解析修正（见 docs/features/hall-of-fame.md）。

alter table leaderboard_record rename to hall_of_fame_record;

alter table hall_of_fame_record
    rename constraint uk_leaderboard_record_arena_player to uk_hall_of_fame_record_arena_player;

alter
index idx_leaderboard_record_damage_dealt rename to idx_hall_of_fame_record_damage_dealt;
alter
index idx_leaderboard_record_tank_damage rename to idx_hall_of_fame_record_tank_damage;
alter
index idx_leaderboard_record_account rename to idx_hall_of_fame_record_account;
alter
index idx_leaderboard_record_created_at rename to idx_hall_of_fame_record_created_at;
alter
index idx_leaderboard_record_replay_hash rename to idx_hall_of_fame_record_replay_hash;

alter table hall_of_fame_record
    add column battle_type varchar(16);

alter table hall_of_fame_record
    add column arena_bonus_type integer;

update hall_of_fame_record
set battle_type      = 'RANDOM',
    arena_bonus_type = 1;

alter table hall_of_fame_record
    alter column battle_type set not null;

alter table hall_of_fame_record
    alter column arena_bonus_type set not null;

alter table hall_of_fame_record
    add constraint ck_hall_of_fame_record_battle_type
        check (battle_type in ('RANDOM', 'RATING'));

-- 统一公开查询主排序：damage DESC → battle type 优先（RATING > RANDOM）→ battleTime → createdAt → id
create index idx_hall_of_fame_record_query
    on hall_of_fame_record (damage_dealt desc, battle_type, battle_time, created_at, id);
