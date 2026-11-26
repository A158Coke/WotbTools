-- V2: 排行榜增加版本号和战斗发生时间。
-- version: 回放文件记录的游戏版本号 (meta.json#version), 如 "11.18.0"。
-- battle_time: 战斗实际发生时间 (meta.json#battleStartTime epoch ms)。
-- 两列均可为 NULL, 兼容旧数据。

alter table leaderboard_record
    add column version     varchar(32);

alter table leaderboard_record
    add column battle_time timestamptz;
