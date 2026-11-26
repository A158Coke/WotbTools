alter table replay_processing_job
    add column attempt_watermark integer not null default 0;
