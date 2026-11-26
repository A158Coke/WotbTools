
create table replay_processing_job (
    job_id           varchar(64) primary key,
    status           varchar(16) not null,
    phase            varchar(32),
    total            integer     not null,
    processed        integer     not null default 0,
    duplicates       integer     not null default 0,
    failures         integer     not null default 0,
    parse_completed  integer     not null default 0,
    parse_succeeded  integer     not null default 0,
    parse_failed     integer     not null default 0,
    error_code       varchar(64),
    cancel_requested boolean     not null default false,
    created_at       timestamp with time zone not null,
    finished_at      timestamp with time zone,
    updated_at       timestamp with time zone not null default now(),
    revision         bigint      not null default 0,

    constraint ck_replay_processing_job_status
        check (status in ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED')),
    constraint ck_replay_processing_job_total
        check (total >= 0),
    constraint ck_replay_processing_job_counters
        check (processed >= 0 and duplicates >= 0 and failures >= 0
            and parse_completed >= 0 and parse_succeeded >= 0 and parse_failed >= 0),
    constraint ck_replay_processing_job_revision
        check (revision >= 0),
    constraint ck_replay_processing_job_parse_progress
        check (parse_completed = parse_succeeded + parse_failed)
);

create index idx_replay_processing_job_expiry
    on replay_processing_job (status, finished_at);

create table replay_processing_source (
    job_id          varchar(64) not null,
    source_index    integer     not null,
    source_id       varchar(32) not null,
    source_name     text        not null,
    status          varchar(16) not null,
    failure_message text,

    constraint pk_replay_processing_source primary key (job_id, source_index),
    constraint fk_replay_processing_source_job
        foreign key (job_id) references replay_processing_job (job_id) on delete cascade,
    constraint ck_replay_processing_source_status
        check (status in ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
    constraint ck_replay_processing_source_index
        check (source_index >= 0)
);

create table replay_processing_operation (
    owner_subject text        not null,
    operation_id  text        not null,
    job_id        varchar(64) not null,
    committed_at  timestamp with time zone not null default now(),

    constraint pk_replay_processing_operation primary key (owner_subject, operation_id),
    constraint fk_replay_processing_operation_job
        foreign key (job_id) references replay_processing_job (job_id) on delete cascade
);

create index idx_replay_processing_operation_job
    on replay_processing_operation (job_id);
