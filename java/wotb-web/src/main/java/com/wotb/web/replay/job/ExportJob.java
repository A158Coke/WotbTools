package com.wotb.web.replay.job;

import java.nio.file.Path;

/**
 * Replay Export Job 运行态（内存态，单实例部署；见 docs/current-plan.md §38）。
 *
 * <p>状态机（终态 exactly once，见 §9）：
 * <pre>
 * QUEUED → PROCESSING → READY
 * QUEUED → CANCELLED
 * PROCESSING → FAILED | CANCELLED
 * </pre>
 * 所有状态迁移在 {@code synchronized} 下进行（CAS 语义：迁移失败返回 {@code false}
 * 即已处于终态，重复调用无副作用）；worker 线程与 status/cancel 请求线程并发安全。
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

    private final String jobId;
    private final String mode;
    private final int total;
    private Status status = Status.QUEUED;
    private Phase phase;
    private int processed;
    private int duplicates;
    private int failures;
    private String errorCode;
    private String filename;
    private String contentType;
    private Path artifactPath;
    private long finishedAtMillis;
    /** 协作取消请求（worker 在安全 checkpoint 检查；QUEUED 时立即终态）。 */
    private volatile boolean cancelRequested;

    public ExportJob(final String jobId, final String mode, final int total) {
        this.jobId = jobId;
        this.mode = mode;
        this.total = total;
    }

    public String jobId() {
        return jobId;
    }

    public String mode() {
        return mode;
    }

    public int total() {
        return total;
    }

    public Path artifactPath() {
        return artifactPath;
    }

    public boolean isCancelled() {
        return cancelRequested;
    }

    /** QUEUED → PROCESSING（worker 开始执行时调用）；已取消/已终态返回 false。 */
    public synchronized boolean startProcessing() {
        if (status != Status.QUEUED) {
            return false;
        }
        status = Status.PROCESSING;
        phase = Phase.PROCESSING_REPLAYS;
        return true;
    }

    /** 推进进度（每个输入文件处理完调用一次，无论成功/重复/失败）。 */
    public synchronized void updateProgress(final int processed, final int duplicates, final int failures) {
        this.processed = processed;
        this.duplicates = duplicates;
        this.failures = failures;
    }

    /** PROCESSING 期间切换 phase；非 PROCESSING 返回 false。 */
    public synchronized boolean advancePhase(final Phase next) {
        if (status != Status.PROCESSING) {
            return false;
        }
        phase = next;
        return true;
    }

    /** PROCESSING → READY（终态，exactly once）。 */
    public synchronized boolean markReady(final String filename, final String contentType, final Path artifactPath) {
        if (status != Status.PROCESSING) {
            return false;
        }
        this.status = Status.READY;
        this.phase = null;
        this.filename = filename;
        this.contentType = contentType;
        this.artifactPath = artifactPath;
        this.finishedAtMillis = System.currentTimeMillis();
        return true;
    }

    /** PROCESSING → FAILED（终态，exactly once）；errorCode 为稳定英文错误码。 */
    public synchronized boolean markFailed(final String errorCode) {
        if (status != Status.PROCESSING) {
            return false;
        }
        this.status = Status.FAILED;
        this.phase = null;
        this.errorCode = errorCode;
        this.finishedAtMillis = System.currentTimeMillis();
        return true;
    }

    /** QUEUED/PROCESSING → CANCELLED（终态，exactly once）。 */
    public synchronized boolean markCancelled() {
        if (status == Status.READY || status == Status.FAILED || status == Status.CANCELLED) {
            return false;
        }
        this.status = Status.CANCELLED;
        this.phase = null;
        this.finishedAtMillis = System.currentTimeMillis();
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
            this.status = Status.CANCELLED;
            this.phase = null;
            this.finishedAtMillis = System.currentTimeMillis();
        }
        return true;
    }

    /** 线程安全快照（status 轮询 / DTO 映射用）。 */
    public synchronized Snapshot snapshot() {
        return new Snapshot(jobId, mode, status, phase, total, processed, duplicates, failures,
                errorCode, filename, contentType);
    }

    public long finishedAtMillis() {
        return finishedAtMillis;
    }
}
