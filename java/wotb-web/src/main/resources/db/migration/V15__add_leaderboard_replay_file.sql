-- 排行榜回放文件元数据：上传时持久化原始 .wotbreplay（SHA-256 内容寻址）。
-- 老记录 4 列全 NULL → 无下载按钮（tolerance）。不做强制 backfill。
alter table leaderboard_record
    add column replay_hash varchar(64),
    add column replay_file_name    varchar(255),
    add column replay_size         bigint,
    add column replay_uploaded_by  varchar(255);

create index idx_leaderboard_record_replay_hash
    on leaderboard_record (replay_hash);
