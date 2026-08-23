package com.wotb.web.replay.job;

/**
 * Replay Processing Job 运行态（内存态，单实例部署；plan §4/§8/§11）。
 *
 * <p>状态机（与 Export Job 完全一致，共用 {@link ReplayJobState}，plan §3）：
 * QUEUED → PROCESSING → READY，PROCESSING → FAILED | CANCELLED，QUEUED → CANCELLED；
 * 终态 exactly once。Phase 仅 {@code PROCESSING_REPLAYS}（该阶段有真实
 * processed/total 进度；不为没有可观察价值的阶段造假 phase，plan §9）。</p>
 *
 * <p>READY 后持有 {@link ProcessedDataset}（Preview / Export / Aggregate 复用，
 * plan §21/§22）；currentFile 供前端显示当前处理文件（截断显示，不作为 metric
 * tag，plan §12/§47）。</p>
 */
public final class ReplayProcessingJob {

    public enum Status {
        QUEUED,
        PROCESSING,
        READY,
        FAILED,
        CANCELLED
    }

    /** 对外不可变快照（DTO 映射用，不暴露内部 result / 可变状态）。 */
    public record Snapshot(String jobId, Status status, String phase,
                           int total, int processed, int valid, int duplicates, int failures,
                           String errorCode, String currentFile) {
    }

    private final ReplayJobState state;
    /** READY 后设置（exactly once 由状态机保证；volatile 供 status 轮询线程读取）。 */
    private volatile ProcessedDataset result;
    /** 当前处理中的输入文件名（进度回调更新；不作为 metric tag）。 */
    private volatile String currentFile;

    public ReplayProcessingJob(final String jobId, final int total) {
        this.state = new ReplayJobState(jobId, total);
    }

    public String jobId() {
        return state.snapshot().jobId();
    }

    public int total() {
        return state.snapshot().total();
    }

    public boolean isCancelled() {
        return state.isCancelled();
    }

    public boolean startProcessing() {
        return state.startProcessing();
    }

    public void updateProgress(final int processed, final int duplicates, final int failures) {
        state.updateProgress(processed, duplicates, failures);
    }

    /** PROCESSING 期间设置当前处理文件（进度回调）；非 PROCESSING 时仍可写（无副作用）。 */
    public void setCurrentFile(final String currentFile) {
        this.currentFile = currentFile;
    }

    public boolean markReady(final ProcessedDataset result) {
        if (!state.markReady()) {
            return false;
        }
        this.result = result;
        return true;
    }

    public boolean markFailed(final String errorCode) {
        return state.markFailed(errorCode);
    }

    public boolean markCancelled() {
        return state.markCancelled();
    }

    public boolean requestCancel() {
        return state.requestCancel();
    }

    /** READY 后返回已处理数据集；未 READY 返回 null。 */
    public ProcessedDataset result() {
        return result;
    }

    /** 线程安全快照（status 轮询 / DTO 映射用）。 */
    public synchronized Snapshot snapshot() {
        final ReplayJobState.Snapshot s = state.snapshot();
        final int valid = Math.max(0, s.processed() - s.duplicates() - s.failures());
        return new Snapshot(s.jobId(), Status.valueOf(s.status().name()), s.phase(),
                s.total(), s.processed(), valid, s.duplicates(), s.failures(),
                s.errorCode(), currentFile);
    }

    /** 创建时间（QUEUED 取消的终态 duration 按「创建 → 取消」计，无 worker 运行时长）。 */
    public long createdAtMillis() {
        return state.createdAtMillis();
    }

    public long finishedAtMillis() {
        return state.finishedAtMillis();
    }
}
