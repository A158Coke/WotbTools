-- 分布式回放控制面：job 已观察到的最新 parser result attempt（单调递增，0 = 尚无结果报告）。
-- PostgresParserOutcomeHandler 据此丢弃陈旧 attempt 的迟到/乱序报告；列本身不参与任何状态
-- 合法性判定（状态机仍由 ReplayJobState 唯一拥有），与 revision 同属「版本号」语义。
alter table replay_processing_job
    add column reported_attempt integer not null default 0;
