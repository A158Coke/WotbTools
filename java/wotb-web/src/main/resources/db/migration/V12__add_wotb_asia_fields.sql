
alter table user_profile
    drop constraint ck_user_profile_wotb_server;

alter table user_profile
    add constraint ck_user_profile_wotb_server
        check (wotb_server in ('CN', 'ASIA'));

alter table user_profile
    add column wotb_account_source varchar(32) not null default 'MANUAL';

alter table user_profile
    add column wotb_account_verified_at timestamptz;
