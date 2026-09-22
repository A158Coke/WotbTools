package com.wotb.web.replay.job;

import java.util.List;
import java.util.Optional;

/**
 * Replay Processing Job 的**权威状态端口**：job/source 生命周期投影与 operationId 幂等索引的
 * 唯一持久化出口。
 *
 * <p><b>生产只有一个实现</b>：{@link PostgresReplayJobAuthority}（PostgreSQL）。进程内（local）
 * 解析平面退出正式架构后，不存在第二个权威，也不存在运行时后端选择器——原先的
 * {@code wotb.replay.processing-job.repository=memory|jdbc} 开关与「无 authority 时回落到纯内存
 * 注册表」的语义已删除。</p>
 *
 * <p><b>为什么必须有它</b>：内存注册表在进程重启后丢失全部 job 状态与 operationId 幂等索引，
 * 而分布式执行（TX 派发 → Yecao parser-worker 执行 → 结果回 TX）要求 job/source 生命周期跨进程、
 * 跨重启可读。</p>
 *
 * <p>状态机规则（合法迁移、终态 exactly-once、取消语义）仍由 {@link ReplayJobState} 唯一拥有，
 * 本端口不复制第二份规则：它保存的永远是「已被 Java 侧确认的状态」，而不是自己判断出的状态。</p>
 *
 * <p>写入输入是不可变快照（{@link ReplayJobPersistenceSnapshot}），绝不回读
 * {@link ReplayProcessingJob} 的可变状态。实现必须保证单次写入的原子性与陈旧写入拒绝（见实现类）。</p>
 */
public interface ReplayJobAuthority {

    /** 持久化后的 job 投影（不含 entries / result / artifact 路径，那些不是权威状态）。 */
    record StoredJob(String jobId,
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
                     long revision,
                     List<ReplayProcessingJob.SourceState> sources) {
    }

    /**
     * 原子覆盖整行投影（register 与每次状态迁移后调用）。
     *
     * <p>被 {@code revision} 判定为陈旧时整次写入不做任何改动（连 source 行也不改写）；
     * 这不丢状态——拒绝的前提是权威状态里已有更新的、已提交的投影。</p>
     */
    void save(ReplayJobPersistenceSnapshot snapshot);

    /**
     * 权威状态里该 job 的 **attempt 水位线**；{@code 0} = 还没有任何 attempt 被报告或重派。
     *
     * <p>它是分布式控制面判定「陈旧报告」的唯一输入：{@code message.attempt < attemptWatermark}
     * 的报告必须丢弃（更晚的 attempt 已经推进过权威状态）。</p>
     */
    int attemptWatermark(String jobId);

    /**
     * 单调推进 attempt 水位线（{@code attempt_watermark = max(current, attempt)}）。
     *
     * <p>刻意不做任何 job 状态判定：状态迁移的唯一所有者仍是状态机，水位线只是一个版本号，
     * 与 revision 同理只用于拒绝乱序/陈旧的并发写入。</p>
     *
     * @return {@code false} 表示该 attempt 已陈旧（权威状态里已有更大的 attempt），调用方必须丢弃
     */
    boolean advanceAttemptWatermark(String jobId, int attempt);

    /** 读取 job 投影（含全部 source，按 source_index 升序）。 */
    Optional<StoredJob> findJob(String jobId);

    /**
     * operationId 幂等索引的读取侧：返回已 COMMITTED 的 jobId。
     *
     * <p>只有「索引存在 **且** job 仍存在」才算 COMMITTED；否则视为 ABSENT（job 被 TTL 清理后，
     * 同一 operationId 可以重新创建）。</p>
     */
    String findCommittedJobId(String ownerSubject, String operationId);

    /**
     * 发布 COMMITTED：同一 {@code (ownerSubject, operationId)} 只有第一次插入成功。
     *
     * <p>这是**跨进程**的权威判定点：{@code false} 表示该 identity 已被另一个 job 占用，
     * 调用方必须解析到已提交的 jobId，而不得返回自己的 jobId。</p>
     *
     * @return {@code true} 表示本调用赢得该 identity
     */
    boolean commitOperation(String ownerSubject, String operationId, String jobId);

    /**
     * 权威状态里当前存在的全部 jobId。
     *
     * <p>启动孤儿目录清理的唯一正确输入：registry 在构造时必然为空，用它判定孤儿会删掉
     * 可恢复 job 的本地产物。</p>
     */
    List<String> listJobIds();

    /** 删除 job 投影（source 与 operation 由外键 cascade 一并删除）。 */
    void deleteJob(String jobId);

    /**
     * 终态且已过期的 job 投影 id（TTL 清理的**候选集**，不直接删除）。
     *
     * <p>刻意返回 id 而不是一次性集合式删除：Dataset Lease（AI / Playback / Export 正在读取）是
     * **进程内**状态，集合式删除看不见它，会把正在被消费的 job 行删掉。调用方按 lease 过滤后再
     * 逐条删除。</p>
     */
    List<String> listExpiredTerminal(long cutoffMillis);
}
