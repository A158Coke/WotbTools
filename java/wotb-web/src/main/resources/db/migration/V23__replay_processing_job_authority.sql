-- V23: Replay Processing Job 的权威状态从「单实例内存注册表」迁移到 PostgreSQL。
--
-- 背景：V22 之前 job 生命周期是进程内 ConcurrentHashMap（ReplayProcessingJobStore），
-- 进程重启即丢状态，operationId 幂等索引同样只在内存。转向分布式执行后
-- （TX 派发 → Yecao parser-worker 执行），job/source 状态必须跨进程、跨重启可读，
-- 因此 PostgreSQL 成为唯一权威状态源；RabbitMQ 只负责投递，不承担状态权威。
--
-- 职责边界（重要）：
--   * 本迁移只建「状态投影」三表：不存回放字节、不存 ParseEntry、不存 Dataset/artifact 内容，
--     那些属于对象存储与本地临时目录，不是 job 权威状态。
--   * job 状态机的合法迁移与终态 exactly-once 仍由 Java 侧（ReplayJobState）保证；
--     这里只持久化观测到的状态，不复制一份状态机规则。
--   * 不引入任何指向 Keycloak 身份的外键（历史 job 与身份解耦，见 V22 的 ownership 决策）。
--   * 不改动任何既有业务表。

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
    -- 单调递增的投影版本（每次状态迁移 +1）：并发/乱序写入时旧快照不得覆盖已提交的新状态。
    -- 它是**同一个** job 状态机的版本号，不是第二套状态规则。
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
    -- parse 三元组在 ReplayProcessingJob 的同一 synchronized transition 内推进，
    -- 对外永远满足 completed = succeeded + failed；这里把它固化为持久化不变量。
    constraint ck_replay_processing_job_parse_progress
        check (parse_completed = parse_succeeded + parse_failed)
);

-- TTL sweeper 的唯一查询形状：终态 + finished_at 早于 cutoff。
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

-- Processing create idempotency 的持久化形态：只记录 COMMITTED（已成功提交给 dispatcher 的 job）。
-- IN_FLIGHT 刻意不建模：它是进程内瞬态 reservation，持久化会在崩溃后留下永不过期的占位，
-- 反而把「同 operationId 重放」永久锁死。重启后重放由本表的 COMMITTED 行命中同一个 jobId。
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
