alter table leaderboard_record
    add column replay_hash         varchar(64),
    add column replay_file_name    varchar(255),
    add column replay_size         bigint,
    add column replay_uploaded_by  varchar(255);

create index idx_leaderboard_record_replay_hash
    on leaderboard_record (replay_hash);
