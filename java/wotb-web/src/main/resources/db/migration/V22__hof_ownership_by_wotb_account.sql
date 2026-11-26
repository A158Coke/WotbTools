
alter table hundred_battle_submission
    rename column game_account_id_snapshot to wotb_account_id;

alter table hundred_battle_submission
    add column wotb_server varchar(16);

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
                   'where s.status in (''PENDING'', ''CURRENT'') group by 1, 2, 3, 4 having count(*) > 1; '
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
                   'where s.status in (''PENDING'', ''CURRENT'') group by 1, 2, 3 having count(*) > 1; '
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
