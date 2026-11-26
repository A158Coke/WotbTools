-- 分布式回放控制面：job 的 attempt 水位线（单调递增，0 = 尚无 attempt 被报告或重派）。
-- PostgresParserOutcomeHandler 据此丢弃陈旧 attempt 的迟到/乱序报告（message.attempt < 水位线），
-- 并在按 PG 权威状态重派 attempt+1 时推进它，使同一 attempt 的重复失败报告自然成为陈旧 no-op。
-- 列本身不参与任何状态合法性判定（状态机仍由 ReplayJobState 唯一拥有），与 revision 同属
-- 「版本号」语义。
alter table replay_processing_job
    add column attempt_watermark integer not null default 0;
