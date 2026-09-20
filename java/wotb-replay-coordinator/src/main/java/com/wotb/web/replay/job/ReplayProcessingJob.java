package com.wotb.web.replay.job;

import com.wotb.core.parse.Replays;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReferenceArray;

/**
 * Replay Processing Job 运行态（内存态，单实例部署）。
 *
 * <p>状态机（与 Export Job 完全一致，共用 {@link ReplayJobState}）：
 * QUEUED → PROCESSING → READY，PROCESSING → FAILED | CANCELLED，QUEUED → CANCELLED；
 * 终态 exactly once。Phase 仅 {@code PROCESSING_REPLAYS}（该阶段有真实
 * processed/total 进度；不为没有可观察价值的阶段造假 phase）。</p>
 *
 * <p>READY 后持有 {@link ProcessedDataset}（Preview / Export / Aggregate 复用，
 * ）；currentFile 供前端显示当前处理文件（截断显示，不作为 metric
 * tag）。</p>
 */
public final class ReplayProcessingJob {

    /** QUEUED：等待当前 processing dispatcher 分配执行 slot。 */
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

    /** 单 source 状态：PENDING → PROCESSING → READY | FAILED。 */
    public enum SourceStatus {
        PENDING,
        PROCESSING,
        READY,
        FAILED
    }

    /** 轻量 source identity + 状态（不含 Battle / byte[] / Reconstruction）。 */
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
    private final long submittedNanos = System.nanoTime();
    /** 固定大小的 per-source 状态（AtomicReferenceArray：worker 线程写、status 轮询线程读）。 */
    private final AtomicReferenceArray<SourceState> sources;
    /** Worker outcomes are stored by source index; batch finalization reads the complete immutable set. */
    private final AtomicReferenceArray<Replays.ParsedEntry> entries;
    /** 终态 observability（日志/指标）exactly-once 记账（QUEUED 取消与 worker 双路径防重）。 */
    private final AtomicBoolean terminalRecorded = new AtomicBoolean();
    /**
     * 状态迁移通知（write-through 持久化挂载点）。为 {@code null} 时本 job 是纯内存态
     * （测试 / 本地开发），行为与本字段引入前逐字一致。
     */
    private volatile ReplayJobTransitionListener transitionListener;
    /**
     * 投影版本：每次状态迁移 +1，**与是否有持久化监听器无关**（内存模式同样递增）。
     * 权威状态用它拒绝乱序/陈旧快照覆盖已提交的新状态；它只是同一个状态机的版本号，
     * 不参与任何状态合法性判定。
     */
    private final AtomicLong revision = new AtomicLong();
    /** READY 后设置（exactly once 由状态机保证；volatile 供 status 轮询线程读取）。 */
    private volatile ProcessedDataset result;
    /** 当前处理中的输入文件名（进度回调更新；不作为 metric tag）。 */
    private volatile String currentFile;
    /**
     * 真实 parse 进度（单 replay full process 完成即推进，与 dedupe/finalize 解耦）。
     * 三个计数只在 {@link #recordParseSuccess()} / {@link #recordParseFailure()}
     * 的同一 synchronized transition 内变更；{@link #snapshot()} 同监视器读取，
     * 保证对外永远看到一致三元组（parseCompleted == parseSucceeded + parseFailed），
     * 且三个计数单调不减。
     */
    private int parseCompleted;
    private int parseSucceeded;
    private int parseFailed;

    /** 测试便利构造器：无真实文件名时用占位名。 */
    public ReplayProcessingJob(final String jobId, final int total) {
        this(jobId, placeholderNames(total));
    }

    /** 以上传顺序文件名构造 per-source 状态（sourceId = r{sourceIndex}）。 */
    public ReplayProcessingJob(final String jobId, final List<String> sourceNames) {
        this.state = new ReplayJobState(jobId, sourceNames.size(), PHASE_WAITING_FOR_WORKER);
        this.sources = new AtomicReferenceArray<>(sourceNames.size());
        this.entries = new AtomicReferenceArray<>(sourceNames.size());
        for (int i = 0; i < sourceNames.size(); i++) {
            final String name = sourceNames.get(i) == null || sourceNames.get(i).isBlank()
                    ? "replay.wotbreplay" : sourceNames.get(i);
            this.sources.set(i, new SourceState("r" + i, i, name, SourceStatus.PENDING, null));
        }
    }

    /**
     * 从持久化投影恢复只读 job 视图（重启后读取权威状态用）。
     *
     * <p>恢复的 job **没有** {@code entries} 与 {@link ProcessedDataset}：执行上下文随进程消失，
     * 无法也不应该从数据库重建。因此它只服务状态读取与取消状态写入，不参与 batch finalize；
     * 需要 Dataset 的读取路径由对象存储承担。</p>
     */
    ReplayProcessingJob(final String jobId, final int total, final List<SourceState> sourceStates,
                        final Status status, final String phase,
                        final int processed, final int duplicates, final int failures,
                        final int parseCompleted, final int parseSucceeded, final int parseFailed,
                        final String errorCode, final boolean cancelRequested,
                        final long createdAtMillis, final long finishedAtMillis,
                        final long revision) {
        this.revision.set(revision);
        this.state = new ReplayJobState(jobId, total, phase, ReplayJobState.Status.valueOf(status.name()),
                processed, duplicates, failures, errorCode, createdAtMillis, finishedAtMillis,
                cancelRequested);
        this.sources = new AtomicReferenceArray<>(total);
        this.entries = new AtomicReferenceArray<>(total);
        for (int i = 0; i < sourceStates.size() && i < total; i++) {
            this.sources.set(i, sourceStates.get(i));
        }
        this.parseCompleted = parseCompleted;
        this.parseSucceeded = parseSucceeded;
        this.parseFailed = parseFailed;
    }

    /** 挂载状态迁移通知（由注册表在 jdbc 模式注册 job 时调用；内存模式不调用）。 */
    void attachTransitionListener(final ReplayJobTransitionListener listener) {
        this.transitionListener = listener;
    }

    /** 当前投影版本（持久化写入的单调序；权威实现在 UPSERT 中以它拒绝陈旧写入）。 */
    long revision() {
        return revision.get();
    }

    private void notifyTransition() {
        // 先取号再通知：监听器（若存在）看到的 version 一定是本次迁移的新值，
        // 因此两次并发持久化之间不存在相同 revision，陈旧写入必然被数据库拒绝。
        revision.incrementAndGet();
        final ReplayJobTransitionListener listener = this.transitionListener;
        if (listener != null) {
            listener.onJobTransition(this);
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
        if (!state.startProcessing()) {
            return false;
        }
        notifyTransition();
        return true;
    }

    public void updateProgress(final int processed, final int duplicates, final int failures) {
        state.updateProgress(processed, duplicates, failures);
        notifyTransition();
    }

    /**
     * 单个 source parse 成功：completed/succeeded 在同一原子 transition 内推进，
     * {@code processed} 兼容字段同步为 parseCompleted（前端旧字段仍可用）。
     */
    public synchronized void recordParseSuccess() {
        parseCompleted++;
        parseSucceeded++;
        state.updateProgress(parseCompleted, 0, 0);
        notifyTransition();
    }

    /**
     * 单个 source parse 失败：completed/failed 在同一原子 transition 内推进，
     * {@code processed} 兼容字段同步为 parseCompleted（前端旧字段仍可用）。
     */
    public synchronized void recordParseFailure() {
        parseCompleted++;
        parseFailed++;
        state.updateProgress(parseCompleted, 0, 0);
        notifyTransition();
    }

    /** PROCESSING 期间切换 phase（WAITING_FOR_WORKER → PROCESSING_REPLAYS → FINALIZING_BATCH）。 */
    public boolean advancePhase(final String phase) {
        if (!state.advancePhase(phase)) {
            return false;
        }
        notifyTransition();
        return true;
    }

    /** PROCESSING 期间设置当前处理文件（进度回调）；非 PROCESSING 时仍可写（无副作用）。 */
    public void setCurrentFile(final String currentFile) {
        this.currentFile = currentFile;
    }

    /** source 开始 full processing（同时更新 currentFile 兼容字段）。 */
    public void markSourceProcessing(final int sourceIndex, final String displayName) {
        this.currentFile = displayName;
        final SourceState s = sources.get(sourceIndex);
        if (s == null) {
            return;
        }
        sources.set(sourceIndex, new SourceState(s.sourceId(), s.sourceIndex(),
                s.sourceName(), SourceStatus.PROCESSING, null));
        notifyTransition();
    }

    /** source 完成 full processing（READY 不代表 batch 级 valid）。 */
    public void markSourceReady(final int sourceIndex) {
        final SourceState s = sources.get(sourceIndex);
        if (s == null) {
            return;
        }
        sources.set(sourceIndex, new SourceState(s.sourceId(), s.sourceIndex(),
                s.sourceName(), SourceStatus.READY, null));
        notifyTransition();
    }

    /** source full processing 失败（记录稳定错误码，不中断 batch）。 */
    public void markSourceFailed(final int sourceIndex, final String failureMessage) {
        final SourceState s = sources.get(sourceIndex);
        if (s == null) {
            return;
        }
        sources.set(sourceIndex, new SourceState(s.sourceId(), s.sourceIndex(),
                s.sourceName(), SourceStatus.FAILED, failureMessage));
        notifyTransition();
    }

    public void recordEntry(final int sourceIndex, final Replays.ParsedEntry entry) {
        entries.set(sourceIndex, entry);
    }

    public List<Replays.ParsedEntry> entriesInOrder() {
        final List<Replays.ParsedEntry> out = new ArrayList<>(entries.length());
        for (int i = 0; i < entries.length(); i++) {
            out.add(entries.get(i));
        }
        return out;
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
        notifyTransition();
        return true;
    }

    public boolean markFailed(final String errorCode) {
        if (!state.markFailed(errorCode)) {
            return false;
        }
        notifyTransition();
        return true;
    }

    public boolean markCancelled() {
        if (!state.markCancelled()) {
            return false;
        }
        notifyTransition();
        return true;
    }

    public boolean requestCancel() {
        if (!state.requestCancel()) {
            return false;
        }
        notifyTransition();
        return true;
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

    public long submittedNanos() {
        return submittedNanos;
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
