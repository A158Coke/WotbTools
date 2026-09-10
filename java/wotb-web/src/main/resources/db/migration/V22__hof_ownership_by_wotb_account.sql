-- V22: 名人堂百场 / 三环 submission 的 ownership 从 Keycloak 身份解耦为 WotB 游戏账号（含区服）。
--
-- canonical owner = (wotb_server, wotb_account_id)，与 user_profile 的
-- UNIQUE (wotb_server, wotb_account_id) 保持一致。
-- 只按 account_id 归属是不完整的业务身份：CN 123456 与 EU 123456 是两个不同账号，
-- 只按账号 ID 归属会造成跨服 ownership / authorization 串号。
--
-- 目标：即使旧 Juhe QQ Keycloak user 被删除、用户以全新 Official QQ 身份重建 Keycloak 用户
-- （sub 完全变化），只要重新绑定同一个 (区服, WotB 账号)，其 HoF 数据即自然重新关联。
--
-- ═══ 本迁移的执行顺序 ═══════════════════════════════════════════════════════
--   1) 新增 wotb_server 快照列（先可空）
--   2) 从 user_profile 回填：仅当旧 user_keycloak_id 对应的 profile **当前仍绑定同一账号**时
--      取其所服——这是唯一有证据支持的来源
--   3) PREFLIGHT（fail fast，不做任何自动消解）：把该表所有问题一次性聚合报出
--        a. UNRESOLVED SERVER —— 存在无法解析区服的历史行
--        b. DUPLICATE ACTIVE ROWS —— 新 ownership 键下存在重复 active 记录
--   4) 收紧 NOT NULL + 区服 CHECK
--   5) 重建唯一性与查询索引为 (wotb_server, wotb_account_id, vehicle_id)
--   6) 删除 user_keycloak_id
--
-- ═══ 本迁移明确不做的事 ═════════════════════════════════════════════════════
--   * 不自动选择 winner、不修改任何 status、不删除任何 replay evidence、不清空任何截图。
--   * 不为了「让新唯一索引能建起来」而改动业务历史。
--   * 不为无法解析区服的历史行猜一个区服（例如默认 CN）。
--
-- 冲突必须由管理员有意处理后再重跑本迁移。Flyway 在 PostgreSQL 上把每个迁移包在单一事务里，
-- 因此 preflight 失败时本迁移的全部 DDL/DML 都会回滚，数据库停留在 V21 状态。
--
-- [重要] 诊断文本的可执行性约束：preflight 失败后 schema 是 V21，wotb_account_id / wotb_server
--   这两列并不存在。因此所有给运维看的检查 SQL 一律只使用 V21 列
--   （user_keycloak_id / game_account_id_snapshot），候选区服通过 LEFT JOIN user_profile 反推。
--   同时不得指引运维使用本次新增的 bulk-delete 端点——迁移失败时新版本起不来，那些端点不可用。
--   修改 hint 文本时必须保持这一约束（HofOwnershipMigrationTest 会断言）。

-- ═══════════════════════════════════════════════════════════════════════════
-- 百场 hundred_battle_submission
-- ═══════════════════════════════════════════════════════════════════════════
alter table hundred_battle_submission
    rename column game_account_id_snapshot to wotb_account_id;

alter table hundred_battle_submission
    add column wotb_server varchar(16);

-- 回填：只有「旧 Keycloak 身份当前仍绑定同一账号」的 profile 才能作为区服的权威来源。
-- 用户已改绑到别的账号（或 profile 已被删除）的行不会被猜值，留给下面的 preflight 报错。
update hundred_battle_submission s
   set wotb_server = p.wotb_server
  from user_profile p
 where p.keycloak_user_id = s.user_keycloak_id
   and p.wotb_account_id = s.wotb_account_id;

do $$
declare
    unresolved_rows   bigint;
    unresolved_sample text;
    conflicts         text;
    problems          text;
begin
    -- (a) 区服可解析性
    select count(*) into unresolved_rows
      from hundred_battle_submission
     where wotb_server is null;

    if unresolved_rows > 0 then
        select string_agg(id::text, ', ' order by id) into unresolved_sample
          from (select id from hundred_battle_submission where wotb_server is null order by id limit 20) t;

        problems := format(
            'UNRESOLVED SERVER: %s row(s) have no user_profile that still binds the same WotB account; sample id(s): %s',
            unresolved_rows, unresolved_sample);
    end if;

    -- (b) ownership 冲突：百场的新唯一索引是两个独立的 partial index（PENDING 一个、CURRENT 一个），
    --     因此按 (区服, 账号, 车辆, 状态) 检查。
    select string_agg(
               format('(candidate_server=%s, game_account_id_snapshot=%s, vehicle_id=%s, status=%s, rows=%s)',
                      wotb_server, wotb_account_id, vehicle_id, status, cnt),
               '; ' order by wotb_server, wotb_account_id, vehicle_id, status)
      into conflicts
      from (
          select wotb_server, wotb_account_id, vehicle_id, status, count(*) as cnt
            from hundred_battle_submission
           where status in ('PENDING', 'CURRENT')
           group by wotb_server, wotb_account_id, vehicle_id, status
          having count(*) > 1
      ) t;

    if conflicts is not null then
        problems := concat_ws(E'\n', problems, 'DUPLICATE ACTIVE ROWS: ' || conflicts);
    end if;

    if problems is not null then
        raise exception using
            errcode = 'raise_exception',
            message = 'V22 preflight failed for hundred_battle_submission: ownership data must be resolved before this migration can run',
            detail = problems,
            hint = 'The schema is still V21 after this failure, so inspect with V21 columns only '
                   '(hundred_battle_submission has user_keycloak_id and game_account_id_snapshot, NOT the '
                   'wotb_* columns). Candidate server: '
                   'select s.id, s.user_keycloak_id, s.game_account_id_snapshot, s.status, '
                   'p.wotb_server as candidate_server '
                   'from hundred_battle_submission s '
                   'left join user_profile p on p.keycloak_user_id = s.user_keycloak_id '
                   'and p.wotb_account_id = s.game_account_id_snapshot '
                   'where p.wotb_server is null; '
                   'Duplicate active rows: '
                   'select p.wotb_server as candidate_server, s.game_account_id_snapshot, s.vehicle_id, s.status, '
                   'count(*) from hundred_battle_submission s '
                   'left join user_profile p on p.keycloak_user_id = s.user_keycloak_id '
                   'and p.wotb_account_id = s.game_account_id_snapshot '
                   "where s.status in ('PENDING', 'CURRENT') group by 1, 2, 3, 4 having count(*) > 1; "
                   'This migration never guesses a server, never changes status, never deletes evidence and '
                   'never clears screenshots. Resolve the rows above intentionally, then rerun the deployment. '
                   'Removal tooling: the currently runnable (pre-upgrade) application exposes '
                   'POST /api/admin/hof/hundred/submissions/{id}/delete, which removes CURRENT submissions only; '
                   'the bulk-delete endpoints belong to this change and are NOT available while this migration '
                   'keeps failing. Rows that are not CURRENT need an explicit operator action either way. '
                   'hundred_battle_replay_evidence references submissions with ON DELETE RESTRICT, so remove that '
                   'evidence first when you remove a submission.';
    end if;
end $$;

alter table hundred_battle_submission
    alter column wotb_server set not null;

alter table hundred_battle_submission
    add constraint ck_hundred_wotb_server
        check (wotb_server in ('CN', 'ASIA', 'EU', 'NA'));

-- 唯一性 / 索引改为以 (区服, WotB 账号) 为界
drop index uk_hundred_battle_pending_user_vehicle;
drop index uk_hundred_battle_current_user_vehicle;
drop index idx_hundred_battle_submission_user;

create unique index uk_hundred_battle_pending_account_vehicle
    on hundred_battle_submission (wotb_server, wotb_account_id, vehicle_id)
    where status = 'PENDING';

create unique index uk_hundred_battle_current_account_vehicle
    on hundred_battle_submission (wotb_server, wotb_account_id, vehicle_id)
    where status = 'CURRENT';

create index idx_hundred_battle_submission_account
    on hundred_battle_submission (wotb_server, wotb_account_id, status, submitted_at desc);

alter table hundred_battle_submission
    drop column user_keycloak_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 三环 mark3_submission（无 SUPERSEDED，CURRENT 即最终记录）
-- ═══════════════════════════════════════════════════════════════════════════
alter table mark3_submission
    rename column game_account_id_snapshot to wotb_account_id;

alter table mark3_submission
    add column wotb_server varchar(16);

update mark3_submission s
   set wotb_server = p.wotb_server
  from user_profile p
 where p.keycloak_user_id = s.user_keycloak_id
   and p.wotb_account_id = s.wotb_account_id;

do $$
declare
    unresolved_rows   bigint;
    unresolved_sample text;
    conflicts         text;
    problems          text;
begin
    select count(*) into unresolved_rows
      from mark3_submission
     where wotb_server is null;

    if unresolved_rows > 0 then
        select string_agg(id::text, ', ' order by id) into unresolved_sample
          from (select id from mark3_submission where wotb_server is null order by id limit 20) t;

        problems := format(
            'UNRESOLVED SERVER: %s row(s) have no user_profile that still binds the same WotB account; sample id(s): %s',
            unresolved_rows, unresolved_sample);
    end if;

    -- 三环的新唯一索引是单个组合 partial index，覆盖 status in (PENDING, CURRENT) 两个状态，
    -- 因此必须【跨状态】按 (区服, 账号, 车辆) 检查冲突。
    select string_agg(
               format('(candidate_server=%s, game_account_id_snapshot=%s, vehicle_id=%s, rows=%s)',
                      wotb_server, wotb_account_id, vehicle_id, cnt),
               '; ' order by wotb_server, wotb_account_id, vehicle_id)
      into conflicts
      from (
          select wotb_server, wotb_account_id, vehicle_id, count(*) as cnt
            from mark3_submission
           where status in ('PENDING', 'CURRENT')
           group by wotb_server, wotb_account_id, vehicle_id
          having count(*) > 1
      ) t;

    if conflicts is not null then
        problems := concat_ws(E'\n', problems, 'DUPLICATE ACTIVE ROWS: ' || conflicts);
    end if;

    if problems is not null then
        raise exception using
            errcode = 'raise_exception',
            message = 'V22 preflight failed for mark3_submission: ownership data must be resolved before this migration can run',
            detail = problems,
            hint = 'The schema is still V21 after this failure, so inspect with V21 columns only '
                   '(mark3_submission has user_keycloak_id and game_account_id_snapshot, NOT the wotb_* columns). '
                   'Mark3 keeps a single active row per (candidate server, game_account_id_snapshot, vehicle_id) '
                   'spanning PENDING and CURRENT, so a CURRENT and a PENDING for the same account/vehicle are also '
                   'a conflict. Candidate server: '
                   'select s.id, s.user_keycloak_id, s.game_account_id_snapshot, s.status, '
                   'p.wotb_server as candidate_server '
                   'from mark3_submission s '
                   'left join user_profile p on p.keycloak_user_id = s.user_keycloak_id '
                   'and p.wotb_account_id = s.game_account_id_snapshot '
                   'where p.wotb_server is null; '
                   'Duplicate active rows: '
                   'select p.wotb_server as candidate_server, s.game_account_id_snapshot, s.vehicle_id, count(*) '
                   'from mark3_submission s '
                   'left join user_profile p on p.keycloak_user_id = s.user_keycloak_id '
                   'and p.wotb_account_id = s.game_account_id_snapshot '
                   "where s.status in ('PENDING', 'CURRENT') group by 1, 2, 3 having count(*) > 1; "
                   'This migration never guesses a server, never changes status, never deletes evidence and '
                   'never clears screenshots. A CURRENT cannot be replaced by a pending application, so keep the '
                   'CURRENT and remove the others, then rerun the deployment. Removal tooling: the currently '
                   'runnable (pre-upgrade) application exposes '
                   'POST /api/admin/hof/mark3/submissions/{id}/delete, which removes CURRENT submissions only; '
                   'the bulk-delete endpoints belong to this change and are NOT available while this migration '
                   'keeps failing. Rows that are not CURRENT need an explicit operator action either way. '
                   'mark3_replay_evidence references submissions with a foreign key, so remove that evidence '
                   'first when you remove a submission.';
    end if;
end $$;

alter table mark3_submission
    alter column wotb_server set not null;

alter table mark3_submission
    add constraint ck_mark3_wotb_server
        check (wotb_server in ('CN', 'ASIA', 'EU', 'NA'));

drop index uk_mark3_submission_active_user_vehicle;
drop index idx_mark3_submission_user;

create unique index uk_mark3_submission_active_account_vehicle
    on mark3_submission (wotb_server, wotb_account_id, vehicle_id)
    where status in ('PENDING', 'CURRENT');

create index idx_mark3_submission_account
    on mark3_submission (wotb_server, wotb_account_id, status, submitted_at desc);

alter table mark3_submission
    drop column user_keycloak_id;
