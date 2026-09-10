-- V22: 名人堂百场 / 三环 submission 的 ownership 从 Keycloak 身份解耦为 WotB 游戏账号。
--
-- 领域模型（本次迁移后）：
--   Keycloak User / QQ / Local Login  仅负责 authentication / authorization
--        └─▶ user_profile（唯一 binding authority：keycloak_user_id UNIQUE、
--            (wotb_server, wotb_account_id) UNIQUE）
--              └─▶ WotB Account ID = canonical business identity
--                    ├─ hall_of_fame_record.account_id（V1/V16 起即按账号归属，本迁移不改）
--                    ├─ hundred_battle_submission.wotb_account_id
--                    └─ mark3_submission.wotb_account_id
--
-- 目标：即使旧 Juhe QQ Keycloak user 被删除、用户以全新 Official QQ 身份重建 Keycloak 用户
-- （sub 完全变化），只要重新绑定同一个 WotB Account，其 HoF 数据即自然重新关联。
--
-- 账号列直接复用既有 game_account_id_snapshot：
--   该列在创建瞬间由 profile.getWotbAccountId() 写入且 NOT NULL，语义上已经是冻结的 WotB 账号 ID，
--   因此重命名为 wotb_account_id 即成为 canonical owner，无需任何回填或 join。
--
-- user_keycloak_id 直接删除：
--   Keycloak user 被删除后该值不再指向任何可解析身份，保留只会诱导后续代码继续按 IAM 归属 HoF。
--
-- 冲突自愈（幂等：无冲突时影响 0 行，与「干净迁移」完全等价）：
--   旧的 (user_keycloak_id, vehicle_id) 唯一性不蕴含 (wotb_account_id, vehicle_id) 唯一性——
--   同一 WotB 账号被两个 Keycloak 身份先后绑定过（user_profile 换绑/删除后重新绑定），
--   各自提交过同车 active 记录时会产生重复。
--   确定性规则（百场按状态、三环跨状态，见下）：
--     百场：新唯一索引是两个独立的 partial index（PENDING 一个、CURRENT 一个），
--           因此按 (账号, 车辆, 状态) 去重——同 (账号,车辆) 同时存在 PENDING 与 CURRENT 是正常状态。
--           同 (账号, 车辆, 状态) 保留 submitted_at 最新的一条（并列取 id 最大）；
--           CURRENT → SUPERSEDED，PENDING → DELETED（delete_reason=ADMIN_CORRECTION）。
--     三环：新唯一索引是单个组合 partial index，覆盖 status in (PENDING, CURRENT) 两个状态，
--           因此必须【跨状态】按 (账号, 车辆) 去重：同 (账号,车辆) 只能留一条 active。
--           规则是 CURRENT 优先（三环 CURRENT 是最终记录、不可被后续申请替代），
--           即先保留最新的 CURRENT，其余 active 行（更旧的 CURRENT 与全部 PENDING）→ DELETED；
--           没有 CURRENT 时才保留最新的 PENDING。
--   与服务层终态语义对齐：同事务删除对应 replay evidence 行并清空 proof 截图。
--   物理回放文件的清理仍是 commit 后的 best-effort 语义（迁移不触碰文件系统），
--   因此极少数被自愈的行会留下无引用 orphan 文件——与既有 HallOfFameAdminService 的
--   「cleanup failed, orphan retained」容忍度一致。
--
-- 说明：刻意不使用临时表——`CREATE TEMP TABLE ... ON COMMIT DROP` 的正确性依赖 Flyway 的
-- 事务模式，改为每条语句自包含的 CTE，对 autocommit / 单事务两种执行方式都成立。

-- ═══════════════════════════════════════════════════════════════════════════
-- 百场 hundred_battle_submission
-- ═══════════════════════════════════════════════════════════════════════════
alter table hundred_battle_submission
    rename column game_account_id_snapshot to wotb_account_id;

-- 冲突自愈（必须在重建唯一索引之前）：先删将被转终态的 submission 的证据行，
-- 此时状态尚未改变，active 排名仍然可见。
with ranked as (
    select id,
           row_number() over (
               partition by wotb_account_id, vehicle_id, status
               order by submitted_at desc, id desc
           ) as rn
      from hundred_battle_submission
     where status in ('PENDING', 'CURRENT')
)
delete from hundred_battle_replay_evidence e
 using ranked r
 where e.submission_id = r.id
   and r.rn > 1;

-- 再把它们转入终态。
with ranked as (
    select id,
           row_number() over (
               partition by wotb_account_id, vehicle_id, status
               order by submitted_at desc, id desc
           ) as rn
      from hundred_battle_submission
     where status in ('PENDING', 'CURRENT')
)
update hundred_battle_submission s
   set status             = case when s.status = 'CURRENT' then 'SUPERSEDED' else 'DELETED' end,
       proof_screenshot   = null,
       deleted_at         = case when s.status = 'PENDING' then now() else s.deleted_at end,
       deleted_by         = case when s.status = 'PENDING' then 'V22_OWNERSHIP_MIGRATION' else s.deleted_by end,
       delete_reason      = case when s.status = 'PENDING' then 'ADMIN_CORRECTION' else s.delete_reason end,
       delete_reason_text = case when s.status = 'PENDING'
                                 then 'V22 ownership migration: duplicate active record for the same WotB account and vehicle'
                                 else s.delete_reason_text end
  from ranked r
 where s.id = r.id
   and r.rn > 1;

-- 唯一性 / 索引改为以 WotB 账号为界
drop index uk_hundred_battle_pending_user_vehicle;
drop index uk_hundred_battle_current_user_vehicle;
drop index idx_hundred_battle_submission_user;

create unique index uk_hundred_battle_pending_account_vehicle
    on hundred_battle_submission (wotb_account_id, vehicle_id)
    where status = 'PENDING';

create unique index uk_hundred_battle_current_account_vehicle
    on hundred_battle_submission (wotb_account_id, vehicle_id)
    where status = 'CURRENT';

create index idx_hundred_battle_submission_account
    on hundred_battle_submission (wotb_account_id, status, submitted_at desc);

alter table hundred_battle_submission
    drop column user_keycloak_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 三环 mark3_submission
-- ═══════════════════════════════════════════════════════════════════════════
alter table mark3_submission
    rename column game_account_id_snapshot to wotb_account_id;

with ranked as (
    select id,
           row_number() over (
               partition by wotb_account_id, vehicle_id
               order by case when status = 'CURRENT' then 0 else 1 end,
                        submitted_at desc,
                        id desc
           ) as rn
      from mark3_submission
     where status in ('PENDING', 'CURRENT')
)
delete from mark3_replay_evidence e
 using ranked r
 where e.submission_id = r.id
   and r.rn > 1;

with ranked as (
    select id,
           row_number() over (
               partition by wotb_account_id, vehicle_id
               order by case when status = 'CURRENT' then 0 else 1 end,
                        submitted_at desc,
                        id desc
           ) as rn
      from mark3_submission
     where status in ('PENDING', 'CURRENT')
)
update mark3_submission s
   set status                  = 'DELETED',
       proof_screenshot_first  = null,
       proof_screenshot_second = null,
       deleted_at              = now(),
       deleted_by              = 'V22_OWNERSHIP_MIGRATION',
       delete_reason           = 'ADMIN_CORRECTION',
       delete_reason_text      = 'V22 ownership migration: duplicate active record for the same WotB account and vehicle'
  from ranked r
 where s.id = r.id
   and r.rn > 1;

drop index uk_mark3_submission_active_user_vehicle;
drop index idx_mark3_submission_user;

create unique index uk_mark3_submission_active_account_vehicle
    on mark3_submission (wotb_account_id, vehicle_id)
    where status in ('PENDING', 'CURRENT');

create index idx_mark3_submission_account
    on mark3_submission (wotb_account_id, status, submitted_at desc);

alter table mark3_submission
    drop column user_keycloak_id;
