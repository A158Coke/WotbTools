
alter table user_profile
    drop constraint ck_user_profile_wotb_server;

alter table user_profile
    add constraint ck_user_profile_wotb_server
        check (wotb_server in ('CN', 'ASIA', 'EU', 'NA'));
