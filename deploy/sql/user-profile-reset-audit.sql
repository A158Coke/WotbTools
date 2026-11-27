
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

select 'user_profile' as relation, count(*) as rows from public.user_profile
union all select 'hundred_battle_submission', count(*) from public.hundred_battle_submission
union all select 'mark3_submission', count(*) from public.mark3_submission
union all select 'admin_user_log', count(*) from public.admin_user_log
union all select 'hall_of_fame_admin_log', count(*) from public.hall_of_fame_admin_log
order by relation;

select 'hundred_battle_submission' as relation,
       count(*) filter (where wotb_server is null or wotb_account_id is null) as unresolved_owner_rows
from public.hundred_battle_submission
union all
select 'mark3_submission',
       count(*) filter (where wotb_server is null or wotb_account_id is null)
from public.mark3_submission;
