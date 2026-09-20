package com.wotb.web.replay.job;

import org.springframework.jdbc.core.simple.JdbcClient;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

/**
 * Replay Processing Job 的 **PostgreSQL 权威状态投影**。
 *
 * <p>本类只负责持久化与读取；状态机规则（合法迁移、终态 exactly-once、取消语义）仍由
 * {@link ReplayJobState} 唯一拥有，本类不复制第二份规则。因此它保存的永远是「已被 Java 侧
 * 确认的状态」，而不是自己判断出的状态。</p>
 *
 * <p><b>为什么需要它</b>：内存注册表在进程重启后丢失全部 job 状态与 operationId 幂等索引，
 * 而分布式执行（TX 派发 → Yecao parser-worker 执行 → 结果回 TX）要求 job/source 生命周期
 * 跨进程、跨重启可读。写入是 write-through（每次状态迁移后覆盖整行投影），读取在内存注册表
 * 未命中时用于恢复只读投影。</p>
 *
 * <p><b>刻意不建模的东西</b>：回放字节、{@code ParsedEntry}、{@code ProcessedDataset}、
 * artifact 内容与本地目录，全部不属于 job 权威状态；{@code IN_FLIGHT} reservation 也不建模，
 * 因为它必须随进程消失，持久化只会留下永不过期的占位。</p>
 *
 * <p>线程安全：{@link JdbcClient} 与数据库事务本身保证并发正确性，本类不持有可变状态。</p>
 */
public final class ReplayJobAuthority {

    private final JdbcClient jdbc;

    public ReplayJobAuthority(final JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** 持久化后的 job 投影（不含 entries / result / artifact 路径，那些不是权威状态）。 */
    public record StoredJob(String jobId,
                            ReplayProcessingJob.Status status,
                            String phase,
                            int total,
                            int processed,
                            int duplicates,
                            int failures,
                            int parseCompleted,
                            int parseSucceeded,
                            int parseFailed,
                            String errorCode,
                            boolean cancelRequested,
                            long createdAtMillis,
                            long finishedAtMillis,
                            List<ReplayProcessingJob.SourceState> sources) {
    }

    /**
     * write-through 覆盖整行投影（register 与每次状态迁移后调用）。
     * source 行做「全量替换」而不是逐条 diff：source 集合在一次 job 生命周期内不变，
     * 替换语义比 diff 简单且没有第二种一致性规则。
     */
    public void save(final ReplayProcessingJob job) {
        final ReplayProcessingJob.Snapshot snapshot = job.snapshot();
        final long finishedAt = job.finishedAtMillis();
        jdbc.sql("""
                        insert into replay_processing_job (
                            job_id, status, phase, total, processed, duplicates, failures,
                            parse_completed, parse_succeeded, parse_failed, error_code,
                            cancel_requested, created_at, finished_at, updated_at)
                        values (:jobId, :status, :phase, :total, :processed, :duplicates, :failures,
                                :parseCompleted, :parseSucceeded, :parseFailed, :errorCode,
                                :cancelRequested, :createdAt, :finishedAt, now())
                        on conflict (job_id) do update set
                            status = excluded.status,
                            phase = excluded.phase,
                            total = excluded.total,
                            processed = excluded.processed,
                            duplicates = excluded.duplicates,
                            failures = excluded.failures,
                            parse_completed = excluded.parse_completed,
                            parse_succeeded = excluded.parse_succeeded,
                            parse_failed = excluded.parse_failed,
                            error_code = excluded.error_code,
                            cancel_requested = excluded.cancel_requested,
                            finished_at = excluded.finished_at,
                            updated_at = now()
                        """)
                .param("jobId", snapshot.jobId())
                .param("status", snapshot.status().name())
                .param("phase", snapshot.phase(), Types.VARCHAR)
                .param("total", snapshot.total())
                .param("processed", snapshot.processed())
                .param("duplicates", snapshot.duplicates())
                .param("failures", snapshot.failures())
                .param("parseCompleted", snapshot.parseCompleted())
                .param("parseSucceeded", snapshot.parseSucceeded())
                .param("parseFailed", snapshot.parseFailed())
                .param("errorCode", snapshot.errorCode(), Types.VARCHAR)
                .param("cancelRequested", job.isCancelled())
                // timestamptz 必须用 OffsetDateTime 写入：java.sql.Timestamp 映射到无时区的
                // TIMESTAMP，依赖服务器时区做隐式转换，会让跨时区读回的毫秒数漂移。
                .param("createdAt", utc(job.createdAtMillis()), Types.TIMESTAMP_WITH_TIMEZONE)
                .param("finishedAt", finishedAt > 0 ? utc(finishedAt) : null,
                        Types.TIMESTAMP_WITH_TIMEZONE)
                .update();

        jdbc.sql("delete from replay_processing_source where job_id = :jobId")
                .param("jobId", snapshot.jobId())
                .update();
        for (final ReplayProcessingJob.SourceState source : snapshot.sources()) {
            jdbc.sql("""
                            insert into replay_processing_source (
                                job_id, source_index, source_id, source_name, status, failure_message)
                            values (:jobId, :sourceIndex, :sourceId, :sourceName, :status, :failureMessage)
                            """)
                    .param("jobId", snapshot.jobId())
                    .param("sourceIndex", source.sourceIndex())
                    .param("sourceId", source.sourceId())
                    .param("sourceName", source.sourceName())
                    .param("status", source.status().name())
                    .param("failureMessage", source.failureMessage(), Types.VARCHAR)
                    .update();
        }
    }

    /** 读取 job 投影（含全部 source，按 source_index 升序）。 */
    public Optional<StoredJob> findJob(final String jobId) {
        final Optional<StoredJob> row = jdbc.sql("""
                        select job_id, status, phase, total, processed, duplicates, failures,
                               parse_completed, parse_succeeded, parse_failed, error_code,
                               cancel_requested, created_at, finished_at
                        from replay_processing_job
                        where job_id = :jobId
                        """)
                .param("jobId", jobId)
                .query((rs, rowNum) -> {
                    final Timestamp finishedAt = rs.getTimestamp("finished_at");
                    return new StoredJob(
                            rs.getString("job_id"),
                            ReplayProcessingJob.Status.valueOf(rs.getString("status")),
                            rs.getString("phase"),
                            rs.getInt("total"),
                            rs.getInt("processed"),
                            rs.getInt("duplicates"),
                            rs.getInt("failures"),
                            rs.getInt("parse_completed"),
                            rs.getInt("parse_succeeded"),
                            rs.getInt("parse_failed"),
                            rs.getString("error_code"),
                            rs.getBoolean("cancel_requested"),
                            rs.getTimestamp("created_at").getTime(),
                            finishedAt == null ? 0L : finishedAt.getTime(),
                            List.of());
                })
                .optional();
        if (row.isEmpty()) {
            return Optional.empty();
        }
        final StoredJob stored = row.get();
        final List<ReplayProcessingJob.SourceState> sources = jdbc.sql("""
                        select source_id, source_index, source_name, status, failure_message
                        from replay_processing_source
                        where job_id = :jobId
                        order by source_index
                        """)
                .param("jobId", jobId)
                .query((rs, rowNum) -> new ReplayProcessingJob.SourceState(
                        rs.getString("source_id"),
                        rs.getInt("source_index"),
                        rs.getString("source_name"),
                        ReplayProcessingJob.SourceStatus.valueOf(rs.getString("status")),
                        rs.getString("failure_message")))
                .list();
        return Optional.of(new StoredJob(stored.jobId(), stored.status(), stored.phase(),
                stored.total(), stored.processed(), stored.duplicates(), stored.failures(),
                stored.parseCompleted(), stored.parseSucceeded(), stored.parseFailed(),
                stored.errorCode(), stored.cancelRequested(),
                stored.createdAtMillis(), stored.finishedAtMillis(), sources));
    }

    /**
     * operationId 幂等索引的读取侧：返回已 COMMITTED 的 jobId。
     *
     * <p>与内存实现同一语义：只有「索引存在 **且** job 仍存在」才算 COMMITTED；否则视为
     * ABSENT（job 被 TTL 清理后，同一 operationId 可以重新创建）。这里用 join 表达该条件，
     * FK 的 cascade 删除是第二层保险。</p>
     */
    public String findCommittedJobId(final String ownerSubject, final String operationId) {
        return jdbc.sql("""
                        select operation.job_id
                        from replay_processing_operation operation
                        join replay_processing_job job on job.job_id = operation.job_id
                        where operation.owner_subject = :ownerSubject
                          and operation.operation_id = :operationId
                        """)
                .param("ownerSubject", ownerSubject)
                .param("operationId", operationId)
                .query(String.class)
                .optional()
                .orElse(null);
    }

    /**
     * 发布 COMMITTED：同一 {@code (ownerSubject, operationId)} 只有第一次插入成功。
     *
     * @return {@code true} 表示本调用赢得该 identity；{@code false} 表示已被另一个提交占用
     *         （单 TX 运行时下不可达，保留为跨进程防护与断言点）
     */
    public boolean commitOperation(final String ownerSubject, final String operationId,
                                   final String jobId) {
        return jdbc.sql("""
                        insert into replay_processing_operation (owner_subject, operation_id, job_id)
                        values (:ownerSubject, :operationId, :jobId)
                        on conflict (owner_subject, operation_id) do nothing
                        """)
                .param("ownerSubject", ownerSubject)
                .param("operationId", operationId)
                .param("jobId", jobId)
                .update() > 0;
    }

    /**
     * 权威状态里当前存在的全部 jobId。
     *
     * <p>启动孤儿目录清理的唯一正确输入：纯内存模式用「空 registry」判定孤儿是对的，
     * 但权威模式下 registry 在构造时必然为空，用它会删掉可恢复 job 的本地产物。</p>
     */
    public List<String> listJobIds() {
        return jdbc.sql("select job_id from replay_processing_job").query(String.class).list();
    }

    /** 删除 job 投影（source 与 operation 由外键 cascade 一并删除）。 */
    public void deleteJob(final String jobId) {
        jdbc.sql("delete from replay_processing_job where job_id = :jobId")
                .param("jobId", jobId)
                .update();
    }

    /**
     * 删除终态且已过期的 job 投影（TTL 的持久化侧）。
     *
     * @return 删除行数，供 sweeper 记账
     */
    public int deleteExpiredTerminal(final long cutoffMillis) {
        return jdbc.sql("""
                        delete from replay_processing_job
                        where status in ('READY', 'FAILED', 'CANCELLED')
                          and finished_at is not null
                          and finished_at < :cutoff
                        """)
                .param("cutoff", utc(cutoffMillis), Types.TIMESTAMP_WITH_TIMEZONE)
                .update();
    }

    private static OffsetDateTime utc(final long epochMillis) {
        return OffsetDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ZoneOffset.UTC);
    }
}
