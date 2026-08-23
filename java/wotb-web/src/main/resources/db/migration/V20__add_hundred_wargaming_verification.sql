-- 百场名人堂：新增 Wargaming API 认证来源与官方统计快照。
-- 存量/人工链路统一回填 MANUAL；WG 来源必须冻结完整的国际服官方 totals。
alter table hundred_battle_submission
    add column verification_source varchar(32) not null default 'MANUAL',
    add column verified_at timestamp with time zone,
    add column verified_server varchar(16),
    add column official_account_battle_count bigint,
    add column official_tank_battle_count bigint,
    add column official_tank_damage_dealt bigint,
    add column official_average_damage integer;

alter table hundred_battle_submission
    add constraint ck_hundred_verification_source
        check (verification_source in ('MANUAL', 'WARGAMING_API')),
    add constraint ck_hundred_verified_server
        check (verified_server is null or verified_server in ('ASIA', 'EU', 'NA')),
    add constraint ck_hundred_wargaming_snapshot
        check (
            verification_source = 'MANUAL'
            or (
                verified_at is not null
                and verified_server in ('ASIA', 'EU', 'NA')
                and official_account_battle_count is not null
                and official_account_battle_count >= 0
                and official_tank_battle_count is not null
                and official_tank_battle_count >= 0
                and official_tank_damage_dealt is not null
                and official_tank_damage_dealt >= 0
                and official_average_damage is not null
                and official_average_damage >= 0
            )
        );
