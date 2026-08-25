package com.wotb.web.replay.job;

/**
 * Replay Job 通用状态机（Export Job 与 Replay Processing Job 共用，composition）。
 *
 * <p>从 PR #118 {@code ExportJob} 抽取的可复用状态组件：job 生命周期、终态
 * exactly-once、真实进度、协作取消、时间戳，全部集中于此，避免两套几乎相同的
 * job infrastructure（plan §3）。两个具体 job（ExportJob / ReplayProcessingJob）
 * 各自组合本组件并持有自己的业务字段（artifact / processed result），不引入
 * abstract inheritance framework。</p>
 *
 * <p>状态机（plan §8，终态 exactly once）：
 * <pre>
 * QUEUED → PROCESSING → READY
 * QUEUED → CANCELLED
 * PROCESSING → FAILED | CANCELLED
 * </pre>
 * 所有状态迁移在 {@code synchronized} 下进行（CAS 语义：迁移失败返回 {@code false}
 * 即已处于终态，重复调用无副作用）；worker 线程与 status/cancel 请求线程并发安全。</p>
 *
 * <p>phase 为自由字符串（null 表示无）：Export 用 {@code PROCESSING_REPLAYS /
 * BUILDING_EXCEL / BUILDING_ARCHIVE}，Processing 用 {@code PROCESSING_REPLAYS}
 * （不为没有可观察价值的阶段造假 phase，plan §9）。</p>
 */
public final class ReplayJobState {

    public enum Status {
        QUEUED,
        PROCESSING,
        READY,
        FAILED,
        CANCELLED
    }

    /** 对外不可变快照（DTO 映射用，不暴露内部可变状态）。 */
    public record Snapshot(String jobId, Status status, String phase,
                           int total, int processed, int duplicates, int failures,
                           String errorCode) {
    }

    private final String jobId;
    private final int total;
    private Status status = Status.QUEUED;
    private String phase;
    private int processed;
    private int duplicates;
    private int failures;
    private String errorCode;
    private final long createdAtMillis;
    private long finishedAtMillis;
    /** 协作取消请求（worker 在安全 checkpoint 检查；QUEUED 时立即终态）。 */
    private volatile boolean cancelRequested;

    public ReplayJobState(final String jobId, final int total) {
        this(jobId, total, null);
    }

    /**
     * 指定初始 phase 的状态机（Processing Job 用 {@code WAITING_FOR_WORKER} 表达
     * QUEUED 阶段等待解析资源；Export Job 保持 null 兼容）。
     */
    public ReplayJobState(final String jobId, final int total, final String initialPhase) {
        this.jobId = jobId;
        this.total = total;
        this.phase = initialPhase;
        this.createdAtMillis = System.currentTimeMillis();
    }

    public boolean isCancelled() {
        return cancelRequested;
    }

    /** QUEUED → PROCESSING（worker 开始执行时调用）；已取消/已终态返回 false。初始 phase = PROCESSING_REPLAYS（Export/Processing 一致）。 */
    public synchronized boolean startProcessing() {
        if (status != Status.QUEUED) {
            return false;
        }
        status = Status.PROCESSING;
        phase = "PROCESSING_REPLAYS";
        return true;
    }

    /** 推进进度（每个输入文件处理完调用一次，无论成功/重复/失败）。 */
    public synchronized void updateProgress(final int processed, final int duplicates, final int failures) {
        this.processed = processed;
        this.duplicates = duplicates;
        this.failures = failures;
    }

    /** PROCESSING 期间切换 phase；非 PROCESSING 返回 false。 */
    public synchronized boolean advancePhase(final String next) {
        if (status != Status.PROCESSING) {
            return false;
        }
        phase = next;
        return true;
    }

    /** PROCESSING → READY（终态，exactly once）。 */
    public synchronized boolean markReady() {
        if (status != Status.PROCESSING) {
            return false;
        }
        status = Status.READY;
        phase = null;
        finishedAtMillis = System.currentTimeMillis();
        return true;
    }

    /** PROCESSING → FAILED（终态，exactly once）；errorCode 为稳定英文错误码。 */
    public synchronized boolean markFailed(final String errorCode) {
        if (status != Status.PROCESSING) {
            return false;
        }
        status = Status.FAILED;
        phase = null;
        this.errorCode = errorCode;
        finishedAtMillis = System.currentTimeMillis();
        return true;
    }

    /** QUEUED/PROCESSING → CANCELLED（终态，exactly once）。 */
    public synchronized boolean markCancelled() {
        if (status == Status.READY || status == Status.FAILED || status == Status.CANCELLED) {
            return false;
        }
        status = Status.CANCELLED;
        phase = null;
        finishedAtMillis = System.currentTimeMillis();
        return true;
    }

    /**
     * 取消请求：QUEUED 立即终态；PROCESSING 置协作取消标志（worker 在
     * checkpoint 后自行 markCancelled）；已终态返回 false（幂等）。
     */
    public synchronized boolean requestCancel() {
        if (status == Status.READY || status == Status.FAILED || status == Status.CANCELLED) {
            return false;
        }
        cancelRequested = true;
        if (status == Status.QUEUED) {
            status = Status.CANCELLED;
            phase = null;
            finishedAtMillis = System.currentTimeMillis();
        }
        return true;
    }

    /** 线程安全快照（status 轮询 / DTO 映射用）。 */
    public synchronized Snapshot snapshot() {
        return new Snapshot(jobId, status, phase, total, processed, duplicates, failures, errorCode);
    }

    /** 创建时间（QUEUED 取消的终态 duration 按「创建 → 取消」计，无 worker 运行时长）。 */
    public long createdAtMillis() {
        return createdAtMillis;
    }

    public long finishedAtMillis() {
        return finishedAtMillis;
    }
}
