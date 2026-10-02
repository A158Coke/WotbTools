-- V27: 删除回放处理 Job 的状态投影三表（forward-only；不改历史 V23 / V24）。
--
-- 服务器没有 parser：回放解析与解析后的全部计算（聚合 / 联赛评分 / xlsx 导出 / 2D 回放数据）
-- 已移到浏览器（上游 Rust Core WASM）。Processing Job / Export Job 端点、
-- ReplayProcessingJobStore、coordinator、parser-worker 与 RabbitMQ / MinIO 适配器
-- 均已删除，这三张表不再有任何读写方。
--
-- V23 建 replay_processing_job / replay_processing_source / replay_processing_operation，
-- V24 给 replay_processing_job 加 attempt_watermark 列。
-- 外键 fk_replay_processing_source_job / fk_replay_processing_operation_job 指向
-- replay_processing_job；索引 idx_replay_processing_job_expiry /
-- idx_replay_processing_operation_job 与 check 约束均从属于各自的表，随表删除。
-- 先删子表再删父表；CASCADE 兜底任何未预见的依赖。
drop table if exists replay_processing_operation cascade;
drop table if exists replay_processing_source cascade;
drop table if exists replay_processing_job cascade;
