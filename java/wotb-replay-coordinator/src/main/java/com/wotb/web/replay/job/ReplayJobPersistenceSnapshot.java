package com.wotb.web.replay.job;

import java.util.List;

/**
 * 一次状态迁移的**不可变持久化快照**（状态 + sources + 计数器 + revision 的单一原子捕获）。
 *
 * <p>这是 {@link ReplayJobAuthority} 唯一的写入口。存在它的原因是一个真实竞态：如果先取
 * 状态快照、再单独读取「当前 revision」，两个并发迁移可能分别读到 A 状态与新 revision，
 * 于是旧状态冒充了已经提交的新版本（两个写入携带同一个 revision，数据库的
 * {@code revision < excluded.revision} 守卫无法区分先后，先到者错误地持久化）。</p>
 *
 * <p>因此 revision 必须与它描述的状态在**同一个监视器边界内**一起捕获，并一起传递；
 * 版本号永远是状态描述的一部分，而不是一个可以后补的独立字段。</p>
 *
 * <p>{@code sources} 在构造时被 {@link List#copyOf} 复制为不可变列表，调用方与写入方都无法
 * 再改动它。</p>
 */
public record ReplayJobPersistenceSnapshot(
        String jobId,
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

    public ReplayJobPersistenceSnapshot {
        sources = List.copyOf(sources);
    }
}
