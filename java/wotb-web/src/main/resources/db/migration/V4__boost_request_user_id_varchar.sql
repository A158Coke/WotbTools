alter table boost_request
    alter column requester_user_id type varchar(64) using requester_user_id::varchar;
