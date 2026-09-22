package com.wotb.web.replay.job;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 内存态 Replay Processing Job 注册表 + 临时输入目录生命周期管理（单实例部署）。
 *
 * <p>目录布局：{@code <root>/<jobId>/input/*}（上传持久化输入）。TTL 清理只回收
 * 终态（READY/FAILED/CANCELLED）过期 job；启动时清理孤儿目录；{@code @PreDestroy}
 * 关闭调度器。目录 / TTL / 孤儿清理 / 删除委托共享 {@link ReplayJobStorage}
 * （与 Export 共用同一存储组件）。</p>
 *
 * <p><b>权威状态</b>：{@link ReplayJobAuthority} 是必需依赖（生产唯一实现是
 * {@link PostgresReplayJobAuthority}）。每次状态迁移 write-through 到 PostgreSQL，并在内存未命中时
 * 从权威状态恢复只读投影（进程重启后 job/source 状态与 operationId 幂等仍可读）。本类仍是 job
 * **执行上下文**（entries / result / 本地产物）的唯一持有者——那部分不可持久化，也不属于权威状态。</p>
 *
 * <p><b>Dataset Lease 生命周期</b>：AI / Playback / Export 消费
 * Processing result 或 derived artifact 前 {@link #acquireForSource(String)} /
 * {@link #acquireForExport(String)} 对 job 的 lease 计数 +1，消费结束后
 * {@link #release(String)} -1；TTL sweeper 只清理 lease 为 0 的过期 job。acquire /
 * release / sweep / remove 全部在同一个 {@code lifecycleLock} 上线性化——成功 acquire
 * 后 sweeper 必然看见 lease 而跳过，sweep/remove 先移除注册后 acquire 必然失败，
 * 绝不存在「acquire 成功但 storage 已删除」的第三种结果。</p>
 */
@Component
public class ReplayProcessingJobStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingJobStore.class);
    /** 冲突后解析权威 winner 的有界重试次数与退避（异常分支专用，最多 ~100ms）。 */
    private static final int AUTHORITY_RESOLVE_ATTEMPTS = 3;
    private static final long AUTHORITY_RESOLVE_BACKOFF_MILLIS = 50L;

    private final ConcurrentHashMap<String, ReplayProcessingJob> jobs = new ConcurrentHashMap<>();
    /**
     * processingJobId → 活跃 Dataset Lease 数（AI / Playback / Export 共享，
     * acquire/release 配对；语义命名，不再叫 export refs）。
     */
    private final ConcurrentHashMap<String, AtomicInteger> datasetLeaseRefs = new ConcurrentHashMap<>();
    /**
     * Dataset 生命周期原子性边界：acquire（lease+1）、release（lease-1）、
     * sweep/remove（registry 移除 + 建立 no-new-acquire 状态）都在这把锁内线性化；
     * 物理磁盘删除在锁外执行（不长时间占锁），但 acquire 在 registry 移除后无法成功。
     */
    private final Object lifecycleLock = new Object();
    private final ReplayJobStorage storage;
    private final long ttlMinutes;
    /**
     * 对象存储工作区回收（distributed 才有）；{@code null} = 该部署没有对象存储工作区。
     * 权威侧 TTL 回收必须**先**调它、成功后才删 PostgreSQL 行。
     */
    private final ReplayJobWorkspaceCleaner workspaceCleaner;
    /**
     * 正在被 TTL sweep 回收的 job（生命周期锁保护）。
     *
     * <p>它把「lease 检查」与「拒绝新 acquire」合成一个线性化步骤：要么 acquire 先赢（lease &gt; 0
     * ⇒ sweeper 跳过），要么 sweep 先赢（已 claim ⇒ 新 acquire 返回 null 而不是拿到一个随后被删的
     * job）。没有它就会出现「请求成功 acquire lease、sweeper 仍把 MinIO 工作区与权威行删掉」的
     * 真实窗口——尤其在 backend 重启后，这些 job 不在 live registry，靠「先从 registry 移除」
     * 的本地保护根本覆盖不到。</p>
     */
    private final Set<String> reclaimingJobs = ConcurrentHashMap.newKeySet();
    /**
     * PostgreSQL 权威状态投影（必需，无运行时后端选择器）。每次状态迁移都 write-through 落库，
     * 且 {@link #get(String)} 在内存未命中时从权威状态恢复只读投影（进程重启后状态仍可读）。
     */
    private final ReplayJobAuthority authority;

    /**
     * Processing create idempotency 的**单一权威状态机**：{@code ownerSubject + '\u0000' + operationId}
     * → {@link OperationState}。只服务 Android external replay 的可重放安全路径（server 已接受但 Native
     * ACK 前进程被杀 → 冷启动后同一份 pending replay 重新提交必须拿回同一个 job）。按 authenticated
     * subject 分域：同一 operationId 在不同 subject 下必须是不同 job，绝不跨用户复用。
     *
     * <p>状态只有三种：{@code ABSENT}（无条目）/ {@code IN_FLIGHT(future)} / {@code COMMITTED(jobId)}；
     * 全部转换都在 {@link #claimOperation} / {@link #commitOperation} / {@link #abandonOperation} /
     * {@link #dropOperationIndex} 的 {@code ConcurrentHashMap#compute} 线性化边界内完成，因此
     * 「committed 检查」与「reservation claim」不是两次独立读取——不存在「lookup 得到 null →
     * 期间 creator 已提交并释放 reservation → 本调用错误地成为第二个 creator」的 TOCTOU 窗口。</p>
     */
    private final ConcurrentHashMap<String, OperationState> operations = new ConcurrentHashMap<>();
    /** 反向索引：processingJobId → operation key（job 被移除时同步清理，不留悬挂 COMMITTED 状态）。 */
    private final ConcurrentHashMap<String, String> jobOperationKeys = new ConcurrentHashMap<>();

    // ---- Processing create idempotency 状态机（Android external replay 可重放安全）----

    /**
     * 单一 operation 状态值：{@code inFlight != null} → IN_FLIGHT（creator 正在创建/提交）；
     * 否则 {@code committedJobId != null} → COMMITTED（已成功提交调度器的 job）。
     */
    private record OperationState(CompletableFuture<String> inFlight, String committedJobId) {

        static OperationState inFlight(final CompletableFuture<String> future) {
            return new OperationState(future, null);
        }

        static OperationState committed(final String jobId) {
            return new OperationState(null, jobId);
        }
    }

    /**
     * {@link #claimOperation} 的结果：COMMITTED（已提交 → 复用 jobId）/ JOIN（已有 creator →
     * 等待其结果）/ CREATOR（本调用成为唯一 creator）。
     */
    public record OperationClaim(Kind kind, String jobId, CompletableFuture<String> inFlight) {

        public enum Kind {
            COMMITTED,
            JOIN,
            CREATOR
        }

        static OperationClaim committed(final String jobId) {
            return new OperationClaim(Kind.COMMITTED, jobId, null);
        }

        static OperationClaim join(final CompletableFuture<String> future) {
            return new OperationClaim(Kind.JOIN, null, future);
        }

        static OperationClaim creator() {
            return new OperationClaim(Kind.CREATOR, null, null);
        }
    }

    /**
     * Processing create idempotency 索引（只读 introspection：诊断与测试断言使用）。
     *
     * <p>Service 侧决策**不**走这里——它通过 {@link #claimOperation} 做单点线性化决策；
     * 本方法只回答「当前是否已有 COMMITTED job」。job 已消失时顺手清理状态（懒失效）。</p>
     */
    public String jobIdForOperation(final String ownerSubject, final String operationId) {
        if (!hasOperationIdentity(ownerSubject, operationId)) {
            return null;
        }
        // 权威索引优先：进程重启后内存 map 为空，同一 operationId 必须仍拿回同一个 jobId。
        // 「job 已被清理 ⇒ 返回 null」由权威实现自己的 join 语义保证（operation 行随外键级联删除）。
        return authority.findCommittedJobId(ownerSubject, operationId);
    }

    /**
     * **单一线性化点**：解析 (subject, operationId) 的权威状态并完成状态转换。
     *
     * <p>三种返回：{@code COMMITTED(jobId)}（已提交，直接复用）/ {@code JOIN(future)}（有 creator
     * 正在创建/提交，等待同一个 future）/ {@code CREATOR}（本调用成为唯一 creator：负责 create +
     * {@code dispatcher.submit}，成功后 {@link #commitOperation}，失败时 {@link #abandonOperation}）。</p>
     *
     * <p>committed 判定与 reservation 领取在同一个 {@code compute} 内完成，因此同一 identity 在任意
     * 并发 interleaving 下最多只有一个 creator。</p>
     */
    public OperationClaim claimOperation(final String ownerSubject, final String operationId,
                                        final CompletableFuture<String> mine) {
        if (!hasOperationIdentity(ownerSubject, operationId)) {
            return OperationClaim.creator();
        }
        // 权威 COMMITTED 参与 claim 线性化：跨进程/重启后已提交的 identity 必须在成为
        // creator 之前就被识别，否则会创建第二个 job。
        final String committedInAuthority = authority.findCommittedJobId(ownerSubject, operationId);
        if (committedInAuthority != null) {
            return OperationClaim.committed(committedInAuthority);
        }
        final String key = operationKey(ownerSubject, operationId);
        final OperationClaim[] decided = new OperationClaim[1];
        operations.compute(key, (k, state) -> {
            if (state == null) {
                decided[0] = OperationClaim.creator();
                return OperationState.inFlight(mine);
            }
            if (state.committedJobId() != null && jobs.get(state.committedJobId()) != null) {
                decided[0] = OperationClaim.committed(state.committedJobId());
                return state;
            }
            if (state.committedJobId() != null) {
                // COMMITTED 但 job 已不在 registry（TTL/显式清理后的残留）：视为 ABSENT，本次成为 creator。
                decided[0] = OperationClaim.creator();
                return OperationState.inFlight(mine);
            }
            decided[0] = OperationClaim.join(state.inFlight());
            return state;
        });
        return decided[0];
    }

    /**
     * publish COMMITTED 并返回该 identity 的**权威 jobId**。
     *
     * <p>进程内只允许 {@code IN_FLIGHT(mine) → COMMITTED(jobId)}；其它状态保守不动（理论不可达）。</p>
     *
     * <p>权威模式下 PostgreSQL 是最终裁决者：若同一 {@code (ownerSubject, operationId)} 已被
     * 另一个进程提交，本调用是 loser——此时必须返回**对方的 jobId**，把本进程的重复 job 协作
     * 取消，并把进程内索引改写到权威 jobId。任何情况下都不会为同一 identity 返回第二个 jobId。</p>
     *
     * <p><b>不变量</b>：本方法返回的 jobId 一定由 PostgreSQL 的
     * {@code (owner_subject, operation_id)} 映射背书。冲突后若解析不到权威 winner，就取消
     * loser 并抛出 {@link ProcessingOperationIdentityUnresolvedException}（fail closed），
     * 而不是退化返回 loser jobId。</p>
     *
     * @return 权威 jobId（通常等于 {@code jobId}；跨进程竞态时是对方的 jobId）
     * @throws ProcessingOperationIdentityUnresolvedException 冲突后无法解析权威 winner
     */
    public String commitOperation(final String ownerSubject, final String operationId,
                                  final CompletableFuture<String> mine, final String jobId) {
        if (!hasOperationIdentity(ownerSubject, operationId)) {
            return jobId;
        }
        final String key = operationKey(ownerSubject, operationId);
        if (authority.commitOperation(ownerSubject, operationId, jobId)) {
            jobOperationKeys.put(jobId, key);
            operations.computeIfPresent(key, (k, state) ->
                    state.inFlight() == mine ? OperationState.committed(jobId) : state);
            return jobId;
        }
        // 跨进程竞态 loser 路径：权威 identity 已属于另一个 job。
        final String winner = resolveAuthoritativeWinner(ownerSubject, operationId);
        if (winner == null) {
            // 插入冲突 ⇒ 本 job 没有赢得权威绑定；随后又解析不到 winner（例如胜者被清理，
            // operation 行随外键级联删除）。此时**绝不返回本 jobId**：它没有权威 operation
            // 映射，返回它会让后续重试看不到 committed identity 而重复创建。
            // 取消 doomed 的重复 job、摘除它的进程内索引，然后 fail closed。
            cancelLoserQuietly(jobId);
            dropOperationIndex(jobId);
            LOGGER.error("replay_processing_operation_conflict_unresolved operationScoped=true jobId={}",
                    jobId);
            throw new ProcessingOperationIdentityUnresolvedException();
        }
        LOGGER.warn("replay_processing_operation_conflict_lost operationScoped=true jobId={} authorityJobId={}",
                jobId, winner);
        jobOperationKeys.put(winner, key);
        dropOperationIndex(jobId);
        operations.computeIfPresent(key, (k, state) -> OperationState.committed(winner));
        // 重复 job 协作取消：它是 doomed 的，绝不把它当作本次提交结果返回。
        cancelLoser(jobId);
        return winner;
    }

    /**
     * 冲突后解析权威 winner（有界重试读）。
     *
     * <p>PostgreSQL 的 {@code ON CONFLICT} 只对**已提交**的行触发，所以冲突之后本应立刻可见；
     * 读不到只可能是该 identity 在此期间被释放（胜者 job 被 TTL/显式清理 → operation 行随外键
     * 级联删除）。一次有界重读覆盖「释放与解析擦肩」的窗口；仍然读不到就让调用方 fail closed，
     * 绝不复用陈旧结论、也不把 loser 当 winner。</p>
     *
     * @return 权威 jobId；{@code null} 表示无法解析（调用方必须 fail closed）
     */
    private String resolveAuthoritativeWinner(final String ownerSubject, final String operationId) {
        for (int attempt = 0; attempt < AUTHORITY_RESOLVE_ATTEMPTS; attempt++) {
            final String winner = authority.findCommittedJobId(ownerSubject, operationId);
            if (winner != null) {
                return winner;
            }
            if (attempt + 1 < AUTHORITY_RESOLVE_ATTEMPTS) {
                try {
                    Thread.sleep(AUTHORITY_RESOLVE_BACKOFF_MILLIS);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return null;
                }
            }
        }
        return null;
    }

    /** 协作取消 doomed 的重复 job（成功与否不影响调用方结论）。 */
    private void cancelLoser(final String jobId) {
        final ReplayProcessingJob loser = jobs.get(jobId);
        if (loser != null) {
            loser.requestCancel();
        }
    }

    /**
     * fail-closed 路径专用：取消 loser，且**不得**让取消过程自身的失败替换掉稳定的失败语义
     * （调用方必须收到 {@link ProcessingOperationIdentityUnresolvedException}）。
     */
    private void cancelLoserQuietly(final String jobId) {
        try {
            cancelLoser(jobId);
        } catch (final RuntimeException e) {
            LOGGER.warn("replay_processing_operation_loser_cancel_failed jobId={} error={}",
                    jobId, e.getMessage());
        }
    }

    /**
     * creator 失败（QUEUE_FULL / 存储失败 / 其它异常）：{@code IN_FLIGHT(mine) → ABSENT}，使同一
     * operationId 的后续请求可以重新创建有效 job。等待中的 duplicate 由 creator 侧
     * {@code completeExceptionally} 一起失败。
     */
    public void abandonOperation(final String ownerSubject, final String operationId,
                                 final CompletableFuture<String> mine) {
        if (!hasOperationIdentity(ownerSubject, operationId)) {
            return;
        }
        operations.computeIfPresent(operationKey(ownerSubject, operationId),
                (k, state) -> state.inFlight() == mine ? null : state);
    }

    /** identity 合法性（service 与 store 共用同一判定，避免两处规则漂移）。 */
    public static boolean hasOperationIdentity(final String ownerSubject, final String operationId) {
        return ownerSubject != null && !ownerSubject.isBlank()
                && operationId != null && !operationId.isBlank();
    }

    /** identity 分域 key：subject 与 operationId 用 NUL 分隔，避免拼接歧义。 */
    private static String operationKey(final String ownerSubject, final String operationId) {
        return ownerSubject + '\u0000' + operationId;
    }

    /**
     * job 被移除（显式清理 / TTL sweep）时同步清理 idempotency 状态：{@code COMMITTED(jobId) → ABSENT}。
     * 绝不误删其它 job 的 identity，也不动正在 IN_FLIGHT 的状态。
     */
    private void dropOperationIndex(final String jobId) {
        final String key = jobOperationKeys.remove(jobId);
        if (key != null) {
            operations.computeIfPresent(key, (k, state) ->
                    jobId.equals(state.committedJobId()) ? null : state);
        }
    }

    @Autowired
    public ReplayProcessingJobStore(
            @Value("${wotb.replay.processing-job.dir:${java.io.tmpdir}/wotb-replay-processing-jobs}") final String dir,
            @Value("${wotb.replay.processing-job.ttl-minutes:30}") final long ttlMinutes,
            final ReplayJobAuthority authority,
            final ObjectProvider<ReplayJobWorkspaceCleaner> workspaceCleaner) {
        this(Path.of(dir), ttlMinutes, authority, workspaceCleaner.getIfAvailable());
    }

    /** 测试便利构造器（权威实现由调用方给定；无对象存储工作区）。 */
    public ReplayProcessingJobStore(final Path dir, final long ttlMinutes,
                                    final ReplayJobAuthority authority) {
        this(dir, ttlMinutes, authority, null);
    }

    /**
     * @param workspaceCleaner {@code null} = 该部署没有对象存储工作区；
     *                         非 null = 权威侧 TTL 回收时**先**清对象存储工作区，再删权威行
     */
    public ReplayProcessingJobStore(final Path dir, final long ttlMinutes,
                                    final ReplayJobAuthority authority,
                                    final ReplayJobWorkspaceCleaner workspaceCleaner) {
        this.authority = authority;
        this.workspaceCleaner = workspaceCleaner;
        this.storage = new ReplayJobStorage(dir.toString(), ttlMinutes, "wotb-replay-processing-job-sweeper");
        this.ttlMinutes = ttlMinutes;
        // 孤儿判定必须用数据库里的 job 集合：用空 registry 会把可恢复 job 的本地产物
        // （输入 / derived artifact）当孤儿删掉。
        final Set<String> knownJobs = Set.copyOf(authority.listJobIds());
        storage.cleanupOrphans(knownJobs);
        storage.startSweeper(this::sweepExpired);
    }

    public Path jobDir(final String jobId) {
        return storage.jobDir(jobId);
    }

    public Path inputDir(final String jobId) {
        return storage.inputDir(jobId);
    }

    /**
     * 登记 job。
     *
     * <p>权威模式下**先持久化再登记**：初始投影写不进去就不允许 job 进入 registry，
     * 因此不存在「内存里有 job、PostgreSQL 里没有」的状态（创建必须 fail closed）。</p>
     */
    public void register(final ReplayProcessingJob job) {
        // 先在 job 监视器内捕获初始投影（revision 0 与该状态成对），再挂监听器，最后落库。
        // job 此刻尚未进入 registry，没有并发迁移窗口；挂上监听器之后每次迁移都自带快照。
        final ReplayJobPersistenceSnapshot initial = job.persistenceSnapshot();
        job.attachTransitionListener(this::persistTransition);
        persistTransition(initial);
        synchronized (lifecycleLock) {
            jobs.put(job.jobId(), job);
        }
    }

    /**
     * **可读 job**：优先返回进程内活对象；权威模式下内存未命中时从 PostgreSQL 权威投影恢复
     * （进程重启后状态仍可读）。恢复的投影**不进入** live registry——执行上下文（entries /
     * 内存 dataset / 本地 job 目录）属于创建它的那个进程，恢复出来的只读投影不得冒充它。
     *
     * <p>分布式下 job 状态权威在 PostgreSQL、dataset 与 artifact 权威在对象存储，因此「可读」
     * 不依赖 live registry：backend 重启后 {@link #acquireForSource(String)} /
     * {@link #acquireForExport(String)} 走这条路径继续服务 Playback / Map Overview / AI Review /
     * Export。</p>
     */
    public ReplayProcessingJob get(final String jobId) {
        final ReplayProcessingJob live = jobs.get(jobId);
        if (live != null) {
            return live;
        }
        return authority.findJob(jobId).map(this::restore).orElse(null);
    }

    private ReplayProcessingJob restore(final ReplayJobAuthority.StoredJob stored) {
        final ReplayProcessingJob restored = new ReplayProcessingJob(
                stored.jobId(), stored.total(), stored.sources(), stored.status(), stored.phase(),
                stored.processed(), stored.duplicates(), stored.failures(),
                stored.parseCompleted(), stored.parseSucceeded(), stored.parseFailed(),
                stored.errorCode(), stored.cancelRequested(),
                stored.createdAtMillis(), stored.finishedAtMillis(), stored.revision());
        restored.attachTransitionListener(this::persistTransition);
        return restored;
    }

    /**
     * write-through 单点：任何状态迁移后原子覆盖整行投影。
     *
     * <p>入参是迁移自身在 job 监视器内捕获的**不可变**快照：本方法不回读 job 的可变状态，
     * 因此不会出现「旧状态配新版本号」。</p>
     *
     * <p><b>失败策略（权威模式）：fail closed，不做 best-effort 遥测</b>。PostgreSQL 是权威，
     * 因此持久化失败时：</p>
     * <ol>
     *   <li>把该 job 从内存 registry 中**驱逐**——此后所有读取都从权威状态解析，绝不会对外
     *       报告一个数据库没有提交的状态；</li>
     *   <li>把原始异常抛回调用方，使这次迁移不被当作成功。</li>
     * </ol>
     * <p>驱逐不是数据丢失：若后续某次迁移成功写库，投影会重新出现（revision 单调，不会覆盖
     * 更新的状态）。</p>
     */
    private void persistTransition(final ReplayJobPersistenceSnapshot snapshot) {
        try {
            authority.save(snapshot);
        } catch (final RuntimeException e) {
            LOGGER.error("replay_processing_job_persist_failed jobId={} revision={} error={}",
                    snapshot.jobId(), snapshot.revision(), e.getMessage());
            evictFromAuthorityView(snapshot.jobId());
            throw e;
        }
    }

    /**
     * 权威不可写时把 job 从内存视图移除（此后读取改走权威状态，避免内存状态冒充权威）。
     *
     * <p>刻意**不取 {@code lifecycleLock}**：本方法在 job 监视器内被调用（迁移回调边界），
     * 而 {@code acquireForSource} / {@code acquireForExport} 的加锁顺序是
     * 「lifecycleLock → job 监视器」，反向获取会死锁。这里只操作并发 map，语义足够——
     * 驱逐与 acquire/sweep 的线性化无关，且重复驱逐幂等。</p>
     */
    private void evictFromAuthorityView(final String jobId) {
        jobs.remove(jobId);
        datasetLeaseRefs.remove(jobId);
        dropOperationIndex(jobId);
    }

    /**
     * Export 开始前获取 Processing result 引用（引用计数 +1，阻止 TTL 清理）。
     * job 不存在或未 READY 返回 null（Export 不得读取未完成/不存在的 result）。
     */
    public ReplayProcessingJob acquireForExport(final String jobId) {
        synchronized (lifecycleLock) {
            if (reclaimingJobs.contains(jobId)) {
                // TTL sweep 已领取回收权：绝不允许「先给 lease、随后工作区被删」。
                return null;
            }
            // 可读视图（live 或从 PG 权威恢复）：dataset 权威在对象存储 / 进程内存，由
            // ReplayProcessingResultReader 决定读得到与否。要求 live registry 命中会把
            // 「backend 重启后 Export 一个已 READY 的 job」永久拒掉——重启是常规运维事件。
            final ReplayProcessingJob job = get(jobId);
            if (job == null) {
                return null;
            }
            if (job.snapshot().status() != ReplayProcessingJob.Status.READY) {
                return null;
            }
            datasetLeaseRefs.computeIfAbsent(jobId, k -> new AtomicInteger()).incrementAndGet();
            return job;
        }
    }

    /**
     * Dataset Lease：AI / Playback 读取 derived artifact 前获取引用
     * （+1，阻止 TTL 清理）。与 {@link #acquireForExport} 不同，不要求 batch READY——
     * per-source READY 即可（Direct Capability 在 batch finalize 前消费）。
     *
     * <p>接受**权威恢复的可读投影**（{@link #get(String)}）：backend 重启后 live registry 为空，
     * 但 PG 仍有 job/source 状态、对象存储仍有 artifact，Playback / Map Overview / AI Review
     * 必须继续可用——否则「PG + MinIO 是权威」这条不变式在重启后就断了。</p>
     */
    public ReplayProcessingJob acquireForSource(final String jobId) {
        synchronized (lifecycleLock) {
            if (reclaimingJobs.contains(jobId)) {
                // TTL sweep 已领取回收权：绝不允许「先给 lease、随后工作区被删」。
                return null;
            }
            final ReplayProcessingJob job = get(jobId);
            if (job == null) {
                return null;
            }
            datasetLeaseRefs.computeIfAbsent(jobId, k -> new AtomicInteger()).incrementAndGet();
            return job;
        }
    }

    /** Export 终态后释放引用（与 {@link #acquireForExport} 配对）。 */
    public void release(final String jobId) {
        synchronized (lifecycleLock) {
            final AtomicInteger counter = datasetLeaseRefs.get(jobId);
            if (counter != null && counter.decrementAndGet() <= 0) {
                datasetLeaseRefs.remove(jobId, counter);
            }
        }
    }

    /** 移除并物理删除整个 job 目录（输入 + artifact/result；registry 移除在锁内，磁盘删除在锁外）。 */
    public void removeAndCleanup(final String jobId) {
        synchronized (lifecycleLock) {
            jobs.remove(jobId);
            datasetLeaseRefs.remove(jobId);
            dropOperationIndex(jobId);
        }
        storage.removeAndCleanup(jobId);
        authority.deleteJob(jobId);
    }

    /**
     * 周期 TTL 清理（同包测试可直接触发；lease > 0 的 job 跳过）。
     * 锁内完成过期判定 + registry 移除（建立 no-new-acquire 状态），
     * 锁外执行物理磁盘删除——acquire 在 registry 移除后无法成功，物理删除不会
     * 与 acquire 竞争出「acquire 成功但 storage 已删」。
     */
    void sweepExpired() {
        final long cutoff = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(ttlMinutes);
        final List<String> toClean = new ArrayList<>();
        synchronized (lifecycleLock) {
            for (final ReplayProcessingJob job : jobs.values()) {
                final ReplayProcessingJob.Snapshot snap = job.snapshot();
                final long finishedAt = job.finishedAtMillis();
                final boolean expired = switch (snap.status()) {
                    case READY, FAILED, CANCELLED -> finishedAt > 0 && finishedAt < cutoff;
                    default -> false;
                };
                if (!expired) {
                    continue;
                }
                final AtomicInteger leases = datasetLeaseRefs.get(job.jobId());
                if (leases != null && leases.get() > 0) {
                    // 活跃 Dataset Lease（AI/Playback/Export）正在消费：跳过，等 release 后下轮清理。
                    continue;
                }
                LOGGER.info("replay_processing_job_cleaned ttl_expired=true jobId={} status={}",
                        job.jobId(), snap.status());
                jobs.remove(job.jobId());
                datasetLeaseRefs.remove(job.jobId());
                dropOperationIndex(job.jobId());
                toClean.add(job.jobId());
            }
        }
        for (final String jobId : toClean) {
            storage.removeAndCleanup(jobId);
        }
        sweepAuthority(cutoff);
    }

    /**
     * 权威侧 TTL 清理：**同一套 Dataset Lease 判定** + **先 MinIO 后 PostgreSQL** 的顺序。
     *
     * <p>lease 是进程内状态，因此这里不能写成一条集合式 delete（那会把正在被 AI / Playback / Export
     * 读取的 job 行删掉，读取中途变成 404）：先取候选 id，跳过有活跃 lease 的，再逐个回收。</p>
     *
     * <p><b>顺序不能反</b>：先删对象存储工作区、成功后才删权威行。反过来若「PG 先删、MinIO 失败」，
     * 权威身份就没了而对象还在——孤儿对象再也没人知道该删；按现在的顺序，「MinIO 成功、PG 失败」只是
     * 权威行留着，下一轮重复一次幂等的 MinIO 回收即可恢复。</p>
     *
     * <p>跨实例共享 lease 不在当前单 TX 运行时部署的范围内——真要多实例，lease 本身必须先变成共享状态。</p>
     */
    private void sweepAuthority(final long cutoff) {
        int removed = 0;
        for (final String jobId : authority.listExpiredTerminal(cutoff)) {
            // 「lease 检查 + 领取回收权」必须在同一把锁内完成：否则会出现「acquire 成功拿到 lease，
            // sweeper 随后仍把工作区与权威行删掉」的窗口（acquire 与 sweep 都在 lifecycleLock 内线性化）。
            if (!claimReclaim(jobId)) {
                continue;
            }
            try {
                // 网络 I/O（MinIO 工作区回收）刻意留在锁外，不长时间占住全局 lifecycle 锁。
                if (!cleanWorkspace(jobId)) {
                    // 对象存储回收没做完 ⇒ **保留**权威行，下一轮 sweep 幂等重试（绝不先删 PG）。
                    continue;
                }
                if (!deleteAuthorityRow(jobId)) {
                    // PG 删除失败同样只是「下一轮再来」：对象存储回收是幂等的，重复执行无害。
                    continue;
                }
                removed++;
            } finally {
                // 成功（权威行已删）与失败（留待下一轮）都必须释放 claim，
                // 否则失败的 job 会永远占着 reclaiming 标记、再也没法回收。
                releaseReclaim(jobId);
            }
        }
        if (removed > 0) {
            LOGGER.info("replay_processing_job_cleaned ttl_expired=true authority_rows={}", removed);
        }
    }

    /**
     * 在生命周期锁内领取「回收中」标记，使「lease 检查」与「禁止新 acquire」成为一个原子步骤。
     *
     * @return {@code false} = 该 job 有活跃 Dataset Lease，或已被另一轮 sweep 领取
     */
    private boolean claimReclaim(final String jobId) {
        synchronized (lifecycleLock) {
            final AtomicInteger leases = datasetLeaseRefs.get(jobId);
            if (leases != null && leases.get() > 0) {
                return false;
            }
            return reclaimingJobs.add(jobId);
        }
    }

    private void releaseReclaim(final String jobId) {
        synchronized (lifecycleLock) {
            reclaimingJobs.remove(jobId);
        }
    }

    /** 删除权威行；单个 job 失败只记录，绝不中断整轮 sweep（其余 job 照常回收，下轮重试它）。 */
    private boolean deleteAuthorityRow(final String jobId) {
        try {
            authority.deleteJob(jobId);
            return true;
        } catch (final RuntimeException e) {
            LOGGER.warn("event=replay_processing_job_authority_delete_failed jobId={} error={}",
                    jobId, e.getMessage());
            return false;
        }
    }

    /**
     * 回收该 job 的对象存储工作区；失败只记录（TTL sleeper 没有调用方可以抛给它）并返回 {@code false}，
     * 让权威行留下来等下一轮。
     */
    private boolean cleanWorkspace(final String jobId) {
        if (workspaceCleaner == null) {
            return true;
        }
        final ReplayProcessingJob job = get(jobId);
        if (job == null) {
            // 权威行在候选集里却读不出来：不正常，但别删任何东西——留给下一轮/operator。
            LOGGER.warn("event=replay_job_workspace_cleanup_skipped jobId={} reason=projection_missing", jobId);
            return false;
        }
        try {
            workspaceCleaner.deleteJobWorkspace(job);
            return true;
        } catch (final IOException | RuntimeException e) {
            LOGGER.warn("event=replay_job_workspace_cleanup_failed jobId={} error={}", jobId, e.getMessage());
            return false;
        }
    }

    @PreDestroy
    public void close() {
        storage.close();
    }
}
