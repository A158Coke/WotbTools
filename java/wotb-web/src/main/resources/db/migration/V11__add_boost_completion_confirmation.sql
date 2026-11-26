
alter table boost_request
    add column completion_submitted_at timestamp with time zone,
    add column auto_confirm_at timestamp with time zone;

update boost_request
set completion_submitted_at = now(),
    auto_confirm_at = now() + interval '72 hours'
where status = 'PENDING_CONFIRM';

create index idx_boost_request_pending_auto_confirm
    on boost_request(auto_confirm_at, id)
    where status = 'PENDING_CONFIRM' and auto_confirm_at is not null;
