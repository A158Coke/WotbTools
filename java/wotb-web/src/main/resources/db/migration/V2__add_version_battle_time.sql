
alter table leaderboard_record
    add column version     varchar(32);

alter table leaderboard_record
    add column battle_time timestamptz;
