
alter table leaderboard_record rename to hall_of_fame_record;

alter table hall_of_fame_record
    rename constraint uk_leaderboard_record_arena_player to uk_hall_of_fame_record_arena_player;

alter index idx_leaderboard_record_damage_dealt rename to idx_hall_of_fame_record_damage_dealt;
alter index idx_leaderboard_record_tank_damage rename to idx_hall_of_fame_record_tank_damage;
alter index idx_leaderboard_record_account rename to idx_hall_of_fame_record_account;
alter index idx_leaderboard_record_created_at rename to idx_hall_of_fame_record_created_at;
alter index idx_leaderboard_record_replay_hash rename to idx_hall_of_fame_record_replay_hash;

alter table hall_of_fame_record
    add column battle_type varchar(16);

alter table hall_of_fame_record
    add column arena_bonus_type integer;

update hall_of_fame_record
   set battle_type = 'RANDOM',
       arena_bonus_type = 1;

alter table hall_of_fame_record
    alter column battle_type set not null;

alter table hall_of_fame_record
    alter column arena_bonus_type set not null;

alter table hall_of_fame_record
    add constraint ck_hall_of_fame_record_battle_type
        check (battle_type in ('RANDOM', 'RATING'));

create index idx_hall_of_fame_record_query
    on hall_of_fame_record (damage_dealt desc, battle_type, battle_time, created_at, id);
