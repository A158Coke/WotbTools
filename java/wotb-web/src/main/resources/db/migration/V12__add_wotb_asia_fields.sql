-- V12: Wargaming.net 亚服登录支持。
-- 扩展 wotb_server 允许 ASIA，新增资料来源与首次可信同步时间字段。
-- 存量 CN 记录通过 DEFAULT 平滑迁移为 MANUAL / NULL，不删除或重建数据。

alter table user_profile
    drop constraint ck_user_profile_wotb_server;

alter table user_profile
    add constraint ck_user_profile_wotb_server
        check (wotb_server in ('CN', 'ASIA'));

alter table user_profile
    add column wotb_account_source varchar(32) not null default 'MANUAL';

alter table user_profile
    add column wotb_account_verified_at timestamptz;
