package com.wotb.web.replay.job;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 测试用 {@link ReplayJobAuthority}：只保存**进程内**可见的权威信息
 * （operationId → jobId 绑定 + 哪些 job 仍存在），不接触数据库。
 *
 * <p>它忠实复现被删除的「纯内存权威」语义，因此原本靠「无 authority 回落」运行的
 * service / store 级测试可以继续验证真实编排（幂等、lease、TTL、清理、恢复），
 * 而无需为每个用例起 PostgreSQL：</p>
 * <ul>
 *   <li>{@code save} 只登记 job 存在（write-through 的落点是数据库，这里不建模投影）；</li>
 *   <li>{@code findJob} 永远为空——与内存模式一致：非 live job 读不到，重启恢复语义由
 *       {@code DistributedRestartRecoveryTest} 用真实 PostgreSQL 覆盖；</li>
 *   <li>{@code findCommittedJobId} 复现生产实现的 join 语义：job 已被 {@code deleteJob}
 *       清理时视为 ABSENT（同一 operationId 可以重新创建）；</li>
 *   <li>attempt 水位线与 TTL 候选集不建模（{@code 0} / 空集），因为它们是权威侧行为，
 *       由 PostgreSQL 测试覆盖。</li>
 * </ul>
 *
 * <p><b>只服务测试</b>：生产只有一个实现 {@link PostgresReplayJobAuthority}。</p>
 */
public final class InMemoryReplayJobAuthority implements ReplayJobAuthority {

    private final Map<String, String> committedOperations = new ConcurrentHashMap<>();
    private final Set<String> liveJobs = ConcurrentHashMap.newKeySet();

    @Override
    public void save(final ReplayJobPersistenceSnapshot snapshot) {
        liveJobs.add(snapshot.jobId());
    }

    @Override
    public int attemptWatermark(final String jobId) {
        return 0;
    }

    @Override
    public boolean advanceAttemptWatermark(final String jobId, final int attempt) {
        return true;
    }

    @Override
    public Optional<StoredJob> findJob(final String jobId) {
        return Optional.empty();
    }

    @Override
    public String findCommittedJobId(final String ownerSubject, final String operationId) {
        final String jobId = committedOperations.get(operationKey(ownerSubject, operationId));
        return jobId != null && liveJobs.contains(jobId) ? jobId : null;
    }

    @Override
    public boolean commitOperation(final String ownerSubject, final String operationId,
                                   final String jobId) {
        return committedOperations.putIfAbsent(operationKey(ownerSubject, operationId), jobId) == null;
    }

    @Override
    public List<String> listJobIds() {
        return List.copyOf(liveJobs);
    }

    @Override
    public void deleteJob(final String jobId) {
        liveJobs.remove(jobId);
    }

    @Override
    public List<String> listExpiredTerminal(final long cutoffMillis) {
        return List.of();
    }

    private static String operationKey(final String ownerSubject, final String operationId) {
        return ownerSubject + '\u0000' + operationId;
    }
}
