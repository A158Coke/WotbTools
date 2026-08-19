-- V4: boost_request.requester_user_id 改为 varchar,存 Keycloak UUID (原为 bigint)
alter table boost_request
    alter column requester_user_id type varchar(64) using requester_user_id::varchar;
