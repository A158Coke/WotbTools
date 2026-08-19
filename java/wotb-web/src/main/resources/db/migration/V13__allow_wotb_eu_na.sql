-- V13: Wargaming.net 欧服/美服支持。
-- 扩展 wotb_server 允许 EU/NA（与 Keycloak WG Provider 的 region 枚举 ASIA/EU/NA 一致）。
-- 仅放宽 CHECK 约束，不改任何现有列；UNIQUE (wotb_server, wotb_account_id) 自动覆盖新区服。

alter table user_profile
drop
constraint ck_user_profile_wotb_server;

alter table user_profile
    add constraint ck_user_profile_wotb_server
        check (wotb_server in ('CN', 'ASIA', 'EU', 'NA'));
