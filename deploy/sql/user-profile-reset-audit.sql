-- Read-only precondition for any proposed user_profile reset.
--
-- Run against a production-consistent snapshot first. This file intentionally
-- contains no DELETE, UPDATE, TRUNCATE, ALTER, CASCADE, temp table or function
-- creation. Any discovered FK, ownership dependency, orphan risk, or business
-- impact is BLOCKED_USER_PROFILE_RESET: report it and obtain a separate,
-- per-impact approval before considering a data change. Count queries are
-- inventory evidence, not permission to mutate data.

-- 1. Database-declared foreign keys that directly reference user_profile.
select
    child_ns.nspname as child_schema,
    child.relname as child_table,
    con.conname as constraint_name,
    pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class child on child.oid = con.conrelid
join pg_namespace child_ns on child_ns.oid = child.relnamespace
join pg_class parent on parent.oid = con.confrelid
join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
where con.contype = 'f'
  and parent_ns.nspname = 'public'
  and parent.relname = 'user_profile'
order by child_schema, child_table, constraint_name;

-- 2. Tables that carry an identity/profile ownership column. This is broader
-- than FK discovery because historical schemas can have application-level
-- ownership without a declared foreign key.
select
    table_schema,
    table_name,
    column_name,
    data_type,
    is_nullable
from information_schema.columns
where table_schema not in ('pg_catalog', 'information_schema')
  and column_name in ('user_profile_id', 'keycloak_user_id', 'user_keycloak_id')
order by table_schema, table_name, column_name;

-- 3. Required business-domain row counts. A non-zero count does not authorize
-- deletion; it tells the operator which ownership behavior must be assessed.
select 'user_profile' as relation, count(*) as rows from public.user_profile
union all select 'hundred_battle_submission', count(*) from public.hundred_battle_submission
union all select 'mark3_submission', count(*) from public.mark3_submission
union all select 'admin_user_log', count(*) from public.admin_user_log
union all select 'hall_of_fame_admin_log', count(*) from public.hall_of_fame_admin_log
order by relation;

-- 5. HoF stays account-owned after V22. This query verifies the data carries
-- the canonical owner dimensions; it is evidence only, never a cleanup input.
select 'hundred_battle_submission' as relation,
       count(*) filter (where wotb_server is null or wotb_account_id is null) as unresolved_owner_rows
from public.hundred_battle_submission
union all
select 'mark3_submission',
       count(*) filter (where wotb_server is null or wotb_account_id is null)
from public.mark3_submission;
