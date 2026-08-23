package com.wotb.web.replay.job;

import java.nio.file.Path;
import java.util.Map;

/**
 * Replay Export Job 运行态（内存态，单实例部署；见 docs/current-plan.md §38）。
 *
 * <p>状态机（终态 exactly once，见 §9）：
 * <pre>
 * QUEUED → PROCESSING → READY
 * QUEUED → CANCELLED
 * PROCESSING → FAILED | CANCELLED
 * </pre>
 * 状态迁移与进度/取消全部委托给共享的 {@link ReplayJobState}（plan §3：不复制两套
 * job infrastructure；Export 与 Processing 共用同一状态机组件）；本类只持有导出
 * 专属字段（mode / artifact / filename / contentType / processingJobId）。所有对外
 * 方法签名保持不变。</p>
 */
public final class ExportJob {

    public enum Status {
        QUEUED,
        PROCESSING,
        READY,
        FAILED,
        CANCELLED
    }

    /** 处理阶段（仅 PROCESSING 期间有意义；区分「解析 replay」与「生成 XLSX/ZIP」）。 */
    public enum Phase {
        PROCESSING_REPLAYS,
        BUILDING_EXCEL,
        BUILDING_ARCHIVE
    }

    /** 对外不可变快照（DTO 映射用，不暴露内部 Path / 可变状态）。 */
    public record Snapshot(String jobId, String mode, Status status, Phase phase,
                           int total, int processed, int duplicates, int failures,
                           String errorCode, String filename, String contentType) {
    }

    private final ReplayJobState state;
    private final String mode;
    /** 来源 Processing Job（null = 传统 multipart 上传路径；非 null = 复用已解析 result，plan §28）。 */
    private final String processingJobId;
    /** 战队名称覆盖（{arenaId}:{team} → 显示名；仅本次导出调用内使用，不保存；plan §12）。 */
    private final Map<String, String> teamNames;
    private String filename;
    private String contentType;
    private Path artifactPath;

    public ExportJob(final String jobId, final String mode, final int total) {
        this(jobId, mode, total, null, Map.of());
    }

    /** 复用 Processing Job result 创建导出（total 为 Processing 输入总数）。 */
    public ExportJob(final String jobId, final String mode, final int total, final String processingJobId) {
        this(jobId, mode, total, processingJobId, Map.of());
    }

    /** 创建导出（带战队名称覆盖；League Rating 导出用，仅本次调用内使用）。 */
    public ExportJob(final String jobId, final String mode, final int total,
                     final String processingJobId, final Map<String, String> teamNames) {
        this.state = new ReplayJobState(jobId, total);
        this.mode = mode;
        this.processingJobId = processingJobId;
        this.teamNames = teamNames == null ? Map.of() : Map.copyOf(teamNames);
    }

    public String jobId() {
        return snapshot().jobId();
    }

    public String mode() {
        return mode;
    }

    /** 来源 Processing Job id（null = 传统上传路径）。 */
    public String processingJobId() {
        return processingJobId;
    }

    /** 战队名称覆盖（{arenaId}:{team} → 显示名；仅本次导出调用内使用）。 */
    public Map<String, String> teamNames() {
        return teamNames;
    }

    public int total() {
        return state.snapshot().total();
    }

    public Path artifactPath() {
        return artifactPath;
    }

    public boolean isCancelled() {
        return state.isCancelled();
    }

    /** QUEUED → PROCESSING（worker 开始执行时调用）；已取消/已终态返回 false。 */
    public boolean startProcessing() {
        return state.startProcessing();
    }

    /** 推进进度（每个输入文件处理完调用一次，无论成功/重复/失败）。 */
    public void updateProgress(final int processed, final int duplicates, final int failures) {
        state.updateProgress(processed, duplicates, failures);
    }

    /** 登记 artifact 目标路径（不改变状态；供 FAILED/CANCELLED 清理 partial artifact）。 */
    public synchronized void trackArtifact(final Path artifact) {
        this.artifactPath = artifact;
    }

    /** PROCESSING 期间切换 phase；非 PROCESSING 返回 false。 */
    public boolean advancePhase(final Phase next) {
        return state.advancePhase(next.name());
    }

    /** PROCESSING → READY（终态，exactly once）。 */
    public synchronized boolean markReady(final String filename, final String contentType, final Path artifactPath) {
        if (!state.markReady()) {
            return false;
        }
        this.filename = filename;
        this.contentType = contentType;
        this.artifactPath = artifactPath;
        return true;
    }

    /** PROCESSING → FAILED（终态，exactly once）；errorCode 为稳定英文错误码。 */
    public boolean markFailed(final String errorCode) {
        return state.markFailed(errorCode);
    }

    /** QUEUED/PROCESSING → CANCELLED（终态，exactly once）。 */
    public boolean markCancelled() {
        return state.markCancelled();
    }

    /**
     * 取消请求：QUEUED 立即终态；PROCESSING 置协作取消标志（worker 在
     * checkpoint 后自行 markCancelled）；已终态返回 false（幂等）。
     */
    public boolean requestCancel() {
        return state.requestCancel();
    }

    /** 线程安全快照（status 轮询 / DTO 映射用）。 */
    public synchronized Snapshot snapshot() {
        final ReplayJobState.Snapshot s = state.snapshot();
        return new Snapshot(s.jobId(), mode, Status.valueOf(s.status().name()),
                s.phase() == null ? null : Phase.valueOf(s.phase()),
                s.total(), s.processed(), s.duplicates(), s.failures(),
                s.errorCode(), filename, contentType);
    }

    /** 创建时间（QUEUED 取消的终态 duration 按「创建 → 取消」计，无 worker 运行时长）。 */
    public long createdAtMillis() {
        return state.createdAtMillis();
    }

    public long finishedAtMillis() {
        return state.finishedAtMillis();
    }
}
