package com.wotb.web.replay.job;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReferenceArray;

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

    /** QUEUED：等待全局 ReplayParseScheduler 分配 CPU slot。 */
    public static final String PHASE_WAITING_FOR_WORKER = "WAITING_FOR_WORKER";
    /** PROCESSING：逐 replay full processing（并发=2）。 */
    public static final String PHASE_PROCESSING_REPLAYS = "PROCESSING_REPLAYS";
    /** PROCESSING 尾段：单线程 deterministic 去重 / League / Rating / 汇总。 */
    public static final String PHASE_FINALIZING_BATCH = "FINALIZING_BATCH";

    public enum Status {
        QUEUED,
        PROCESSING,
        READY,
        FAILED,
        CANCELLED
    }

    /** 单 source 状态（plan §42）：PENDING → PROCESSING → READY | FAILED。 */
    public enum SourceStatus {
        PENDING,
        PROCESSING,
        READY,
        FAILED
    }

    /** 轻量 source identity + 状态（不含 Battle / byte[] / Reconstruction，plan §8/§16）。 */
    public record SourceState(String sourceId, int sourceIndex, String sourceName,
                              SourceStatus status, String failureMessage) {
    }

    /** 当前并行处理中的 source（前端 activeSources[]，通常 ≤2）。 */
    public record ActiveSource(String sourceId, int sourceIndex, String displayName) {
    }

    /** 对外不可变快照（DTO 映射用，不暴露内部 result / 可变状态）。 */
    public record Snapshot(String jobId, Status status, String phase,
                           int total, int processed, int valid, int duplicates, int failures,
                           String errorCode, String currentFile,
                           int parseCompleted, int parseSucceeded, int parseFailed,
                           List<SourceState> sources, List<ActiveSource> activeSources) {
    }

    private final ReplayJobState state;
    /** 固定大小的 per-source 状态（AtomicReferenceArray：worker 线程写、status 轮询线程读）。 */
    private final AtomicReferenceArray<SourceState> sources;
    /** 终态 observability（日志/指标）exactly-once 记账（QUEUED 取消与 worker 双路径防重）。 */
    private final AtomicBoolean terminalRecorded = new AtomicBoolean();
    /** READY 后设置（exactly once 由状态机保证；volatile 供 status 轮询线程读取）。 */
    private volatile ProcessedDataset result;
    /** 当前处理中的输入文件名（进度回调更新；不作为 metric tag）。 */
    private volatile String currentFile;
    /** 真实 parse 进度（单 replay full process 完成即推进，与 dedupe/finalize 解耦）。 */
    private volatile int parseCompleted;
    private volatile int parseSucceeded;
    private volatile int parseFailed;

    /** 测试便利构造器：无真实文件名时用占位名。 */
    public ReplayProcessingJob(final String jobId, final int total) {
        this(jobId, placeholderNames(total));
    }

    /** 以上传顺序文件名构造 per-source 状态（sourceId = r{sourceIndex}，plan §9）。 */
    public ReplayProcessingJob(final String jobId, final List<String> sourceNames) {
        this.state = new ReplayJobState(jobId, sourceNames.size(), PHASE_WAITING_FOR_WORKER);
        this.sources = new AtomicReferenceArray<>(sourceNames.size());
        for (int i = 0; i < sourceNames.size(); i++) {
            final String name = sourceNames.get(i) == null || sourceNames.get(i).isBlank()
                    ? "replay.wotbreplay" : sourceNames.get(i);
            this.sources.set(i, new SourceState("r" + i, i, name, SourceStatus.PENDING, null));
        }
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

    /**
     * 推进真实 parse 进度（每个输入完成 full process 后调用一次，无论成功/失败）；
     * {@code processed} 兼容字段同步为 parseCompleted（前端旧字段仍可用）。
     */
    public void updateParseProgress(final int completed, final int succeeded, final int failed) {
        this.parseCompleted = completed;
        this.parseSucceeded = succeeded;
        this.parseFailed = failed;
        state.updateProgress(completed, 0, 0);
    }

    /** PROCESSING 期间切换 phase（WAITING_FOR_WORKER → PROCESSING_REPLAYS → FINALIZING_BATCH）。 */
    public boolean advancePhase(final String phase) {
        return state.advancePhase(phase);
    }

    /** PROCESSING 期间设置当前处理文件（进度回调）；非 PROCESSING 时仍可写（无副作用）。 */
    public void setCurrentFile(final String currentFile) {
        this.currentFile = currentFile;
    }

    /** source 开始 full processing（同时更新 currentFile 兼容字段）。 */
    public void markSourceProcessing(final int sourceIndex, final String displayName) {
        this.currentFile = displayName;
        final SourceState s = sources.get(sourceIndex);
        if (s != null) {
            sources.set(sourceIndex, new SourceState(s.sourceId(), s.sourceIndex(),
                    s.sourceName(), SourceStatus.PROCESSING, null));
        }
    }

    /** source 完成 full processing（READY 不代表 batch 级 valid，plan §29）。 */
    public void markSourceReady(final int sourceIndex) {
        final SourceState s = sources.get(sourceIndex);
        if (s != null) {
            sources.set(sourceIndex, new SourceState(s.sourceId(), s.sourceIndex(),
                    s.sourceName(), SourceStatus.READY, null));
        }
    }

    /** source full processing 失败（记录稳定错误码，不中断 batch，plan §106）。 */
    public void markSourceFailed(final int sourceIndex, final String failureMessage) {
        final SourceState s = sources.get(sourceIndex);
        if (s != null) {
            sources.set(sourceIndex, new SourceState(s.sourceId(), s.sourceIndex(),
                    s.sourceName(), SourceStatus.FAILED, failureMessage));
        }
    }

    /** 线程安全 per-source 快照（按 sourceIndex 顺序，不暴露内部数组）。 */
    public List<SourceState> sourceStates() {
        final List<SourceState> out = new ArrayList<>(sources.length());
        for (int i = 0; i < sources.length(); i++) {
            final SourceState s = sources.get(i);
            if (s != null) {
                out.add(s);
            }
        }
        return List.copyOf(out);
    }

    /** 当前并行处理中的 source（≤2；前端 activeSources[] 显示）。 */
    public List<ActiveSource> activeSources() {
        final List<ActiveSource> out = new ArrayList<>();
        for (int i = 0; i < sources.length(); i++) {
            final SourceState s = sources.get(i);
            if (s != null && s.status() == SourceStatus.PROCESSING) {
                out.add(new ActiveSource(s.sourceId(), s.sourceIndex(), s.sourceName()));
            }
        }
        return List.copyOf(out);
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

    /** 终态日志/指标记账 CAS（重复调用返回 false，防取消线程与 worker 双记账）。 */
    public boolean markTerminalRecorded() {
        return terminalRecorded.compareAndSet(false, true);
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
                s.errorCode(), currentFile,
                parseCompleted, parseSucceeded, parseFailed,
                sourceStates(), activeSources());
    }

    /** 创建时间（QUEUED 取消的终态 duration 按「创建 → 取消」计，无 worker 运行时长）。 */
    public long createdAtMillis() {
        return state.createdAtMillis();
    }

    public long finishedAtMillis() {
        return state.finishedAtMillis();
    }

    private static List<String> placeholderNames(final int total) {
        final List<String> names = new ArrayList<>(total);
        for (int i = 0; i < total; i++) {
            names.add("replay-" + i + ".wotbreplay");
        }
        return names;
    }
}
