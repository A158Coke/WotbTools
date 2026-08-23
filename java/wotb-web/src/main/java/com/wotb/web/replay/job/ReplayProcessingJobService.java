package com.wotb.web.replay.job;

import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.Replays;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.PotentialDamage;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.mapper.Mapper;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replay.service.ReplayService;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * Replay Processing Job 编排（plan §5–§11 / §21–§22 / §34–§38）。
 *
 * <p><b>为什么是 Job</b>：把「上传多个 replay → 解析预览」从长同步 HTTP 改为异步
 * Processing Job——create 快速返回 202 + jobId，worker 在全局 replay 容量内串行
 * processFull（每个 replay 恰好一次，plan §56），产出 {@link ProcessedDataset}
 * 供 Preview / Export / Aggregate 复用（plan §27：不再 Preview ×34 后又 Export ×34）。</p>
 *
 * <p>Create（request 线程）：校验 → 把上传输入持久化到 job 临时目录（绝不在异步
 * worker 持有 {@code MultipartFile}，plan §6）→ 注册 job → 提交有界 worker 池
 * （复用 {@link ReplayExportWorkerExecutor}，plan §35：同一 bounded queue，不复制
 * 两套 worker executor）→ 202。Worker：全局容量许可（plan §34：max-concurrent-jobs=2
 * 不提高）→ 逐文件 full processing（与 preview 同一 authoritative 链，plan §26）→
 * 真实进度（processed/total + valid/duplicates/failures，plan §10/§11）→ READY +
 * 内存态 ProcessedDataset（Strategy A，TTL 与 Job 一致，plan §24）。</p>
 *
 * <p>状态机 / 进度 / 取消 / 终态 observability 对齐 PR #118 Export Job（共用
 * {@link ReplayJobState} 与 {@link ReplayJobStorage}）；QUEUED 取消立即释放
 * executor queue slot（plan §36），PROCESSING 协作取消（plan §37）。</p>
 */
@Service
public class ReplayProcessingJobService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingJobService.class);

    private final ReplayCapacityLimiter capacityLimiter;
    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayProcessingJobStore store;
    /** 与 Export Job 共用的有界 worker 池（plan §35：同一队列容量，不复制两套 executor）。 */
    private final ReplayExportWorkerExecutor workerExecutor;
    private final MeterRegistry meterRegistry;
    private final Tankopedia tankopedia = Tankopedia.load();

    @Autowired
    public ReplayProcessingJobService(final ReplayCapacityLimiter capacityLimiter,
                                      final DefaultReplayProcessingFacade processingFacade,
                                      final ReplayProcessingJobStore store,
                                      final ReplayExportWorkerExecutor workerExecutor,
                                      @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.capacityLimiter = capacityLimiter;
        this.processingFacade = processingFacade;
        this.store = store;
        this.workerExecutor = workerExecutor;
        this.meterRegistry = meterRegistry;
    }

    // ---- create / status / cancel / result ----

    /**
     * 创建 Replay Processing Job：校验并持久化输入后返回 jobId（202 语义）。
     * 队列满载抛 {@link ProcessingQueueFullException}（503 PROCESSING_QUEUE_FULL）。
     */
    public String createJob(final MultipartFile[] files) {
        ReplayUploadValidator.validate(files);
        if (files.length > ReplayService.MAX_REPLAY_FILES) {
            throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
        }
        final String jobId = UUID.randomUUID().toString();
        final Path inputDir = store.inputDir(jobId);
        try {
            Files.createDirectories(inputDir);
            int i = 0;
            for (final MultipartFile f : files) {
                final String name = f.getOriginalFilename() == null ? "replay.wotbreplay" : f.getOriginalFilename();
                f.transferTo(inputDir.resolve(i + "__" + ReplayJobFiles.sanitizeFileName(name)));
                i++;
            }
        } catch (final IOException e) {
            store.removeAndCleanup(jobId);
            throw new IllegalStateException("PROCESSING_JOB_STORAGE_UNAVAILABLE");
        }
        final ReplayProcessingJob job = new ReplayProcessingJob(jobId, files.length);
        store.register(job);
        final long submittedNanos = System.nanoTime();
        try {
            workerExecutor.submit(jobId, () -> runJob(job, inputDir, submittedNanos));
        } catch (final RejectedExecutionException e) {
            store.removeAndCleanup(jobId);
            throw new ProcessingQueueFullException();
        }
        recordCreated(files.length);
        LOGGER.info(logLine("processing_job_created", jobId, "files", files.length));
        return jobId;
    }

    public ReplayProcessingJob.Snapshot status(final String jobId) {
        return requireJob(jobId).snapshot();
    }

    /**
     * 取消：QUEUED 立即终态并真正释放 executor queue slot（{@code removeQueued}）；
     * PROCESSING 协作取消（worker checkpoint 后终态）。与 Export Job 同一取消语义。
     */
    public boolean cancel(final String jobId) {
        final ReplayProcessingJob job = requireJob(jobId);
        final boolean changed = job.requestCancel();
        if (changed) {
            final boolean removed = workerExecutor.removeQueued(jobId);
            if (removed) {
                // QUEUED 任务已被移除、Runnable 永不执行 → 请求线程直接记录终态 observability。
                finishTerminalQueuedCancel(job);
            }
        }
        return changed;
    }

    /**
     * READY 后返回 Preview 数据（plan §21：GET result 不再重新 process replay）。
     * 未 READY / 已清理返回 409 JOB_NOT_READY。
     */
    public PreviewResponse result(final String jobId) {
        final ReplayProcessingJob job = requireJob(jobId);
        final ReplayProcessingJob.Snapshot snap = job.snapshot();
        if (snap.status() != ReplayProcessingJob.Status.READY || job.result() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "JOB_NOT_READY");
        }
        final ProcessedDataset ds = job.result();
        return Mapper.toPreviewResponse(ds.battles(), ds.battleSourceNames(),
                ds.duplicates(), ds.failures(), tankopedia, ds.league());
    }

    private ReplayProcessingJob requireJob(final String jobId) {
        final ReplayProcessingJob job = store.get(jobId);
        if (job == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND");
        }
        return job;
    }

    // ---- worker 执行 ----

    private void runJob(final ReplayProcessingJob job, final Path inputDir, final long submittedNanos) {
        final long startNanos = System.nanoTime();
        recordQueueWait(submittedNanos, startNanos);
        try {
            if (!job.startProcessing()) {
                // QUEUED 期间被取消 → 已终态 CANCELLED；worker 负责终态统计。
                finishTerminal(job, startNanos);
                return;
            }
            if (job.isCancelled()) {
                job.markCancelled();
                finishTerminal(job, startNanos);
                return;
            }
            LOGGER.info(logLine("processing_job_started", job.jobId(), "total", job.total()));
            // 全局 replay 容量仍然生效（plan §34）：job 化不绕过 max-concurrent-jobs=2。
            capacityLimiter.acquire();
            try {
                processJob(job, inputDir);
            } finally {
                capacityLimiter.release();
            }
            finishTerminal(job, startNanos);
        } catch (final JobCancelledException e) {
            job.markCancelled();
            finishTerminal(job, startNanos);
        } catch (final Exception e) {
            if (job.isCancelled()) {
                job.markCancelled();
            } else {
                job.markFailed(errorCodeOf(e));
            }
            finishTerminal(job, startNanos);
        } catch (final Error e) {
            // 未预期 JVM 级错误也必须终态，绝不把 job 留在 PROCESSING。
            LOGGER.error(logLine("processing_job_aborted", job.jobId(), "error", e.getClass().getSimpleName()), e);
            if (job.isCancelled()) {
                job.markCancelled();
            } else {
                job.markFailed("PROCESSING_JOB_FAILED");
            }
            finishTerminal(job, startNanos);
        }
    }

    /**
     * 核心处理：与 preview 同一 authoritative full processing 链（processFull =
     * reconstruction + ObservedMaxHp + DeathTimeReconciler），按上传顺序串行
     * （plan §55 禁止 batch 内并发），真实进度（每个输入成功/重复/失败都推进
     * processed，plan §10），完成后 enrich 一次并保存 ProcessedDataset（plan §21/§22）。
     */
    private void processJob(final ReplayProcessingJob job, final Path inputDir) throws Exception {
        final List<Path> inputs = ReplayJobFiles.listInputsInOrder(inputDir);
        final int[] counters = new int[3]; // processed / duplicates / failures
        final Replays.ReplayProgressListener progress = (source, outcome) -> {
            counters[0]++;
            if (outcome == Replays.Outcome.DUPLICATE) {
                counters[1]++;
            }
            if (outcome == Replays.Outcome.FAILURE) {
                counters[2]++;
            }
            job.updateProgress(counters[0], counters[1], counters[2]);
            LOGGER.debug(logLine("processing_job_progress", job.jobId(), "processed", counters[0],
                    "duplicates", counters[1], "failures", counters[2], "total", job.total()));
            // 安全 checkpoint：每个 replay 完成后检查取消（plan §37）。
            if (job.isCancelled()) {
                throw new JobCancelledException();
            }
        };
        final LeagueReplays.LeagueCollectResult c = LeagueReplays.collect(
                ReplayJobFiles.lazySources(inputs), source -> {
                    // 当前处理文件（前端截断显示；不作为 metric tag，plan §12/§47）。
                    job.setCurrentFile(source.name());
                    return processFullTracked(source);
                }, null, progress);
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        if (c.mode() == LeagueRatingMode.MIXED_UNSUPPORTED) {
            // 混合批次：整个请求拒绝（不返回部分预览）；job 终态错误码供前端三语展示。
            throw new IllegalArgumentException("MIXED_LEAGUE_AND_STANDARD_REPLAYS");
        }
        if (c.battles().isEmpty()) {
            throw new NoValidReplaysException();
        }
        // 事实层 enrich 一次：Preview / Export 直接消费已 enrich 的 authoritative Battle（plan §21/§27）。
        // League 模式不调用 PerformanceMetricsCalculator（旧 contribution/kast/impact 完全移除）。
        PotentialDamage.apply(c.battles(), tankopedia);
        if (c.mode() == LeagueRatingMode.LEAGUE_RATING) {
            job.markReady(new ProcessedDataset(c.battles(), c.battleSourceNames(),
                    c.duplicates(), c.failures(), c.leagueBatch()));
            return;
        }
        for (final Battle battle : c.battles()) {
            PerformanceMetricsCalculator.populateBattle(battle);
        }
        job.markReady(new ProcessedDataset(c.battles(), c.battleSourceNames(),
                c.duplicates(), c.failures(), null));
    }

    /** 与 preview/export 完全相同的 authoritative full processing 链（plan §26，禁止 raw parse 回归）。 */
    private Battle processFull(final Source source) {
        final ReplayProcessingResult result = processingFacade.process(source, ReplayProcessingOptions.full());
        if (result.battle() != null) {
            return result.battle();
        }
        final String message = result.error() != null && StringUtils.hasText(result.error().message())
                ? result.error().message() : "REPLAY_PROCESSING_FAILED";
        throw new IllegalArgumentException(message);
    }

    /** 单文件处理 + 逐文件耗时指标（低基数，无 filename tag，plan §48）。 */
    private Battle processFullTracked(final Source source) {
        if (meterRegistry == null) {
            return processFull(source);
        }
        final Timer.Sample sample = Timer.start(meterRegistry);
        try {
            return processFull(source);
        } finally {
            sample.stop(Timer.builder("wotb_replay_processing_file_duration_seconds")
                    .description("单个 replay full processing 耗时")
                    .publishPercentileHistogram()
                    .register(meterRegistry));
        }
    }

    /** 终态收尾（exactly once 由状态机保证）：日志 + 指标；终态保留到 TTL（store sweeper 清理）。 */
    private void finishTerminal(final ReplayProcessingJob job, final long startNanos) {
        final ReplayProcessingJob.Snapshot snap = job.snapshot();
        logTerminal(snap);
        recordTerminal(snap, System.nanoTime() - startNanos);
    }

    /** QUEUED 取消的终态收尾（任务已 removeQueued、Runnable 永不执行，由请求线程直接记录）。 */
    private void finishTerminalQueuedCancel(final ReplayProcessingJob job) {
        final ReplayProcessingJob.Snapshot snap = job.snapshot();
        logTerminal(snap);
        recordTerminal(snap, TimeUnit.MILLISECONDS.toNanos(System.currentTimeMillis() - job.createdAtMillis()));
    }

    private void logTerminal(final ReplayProcessingJob.Snapshot snap) {
        switch (snap.status()) {
            case READY -> LOGGER.info(logLine("processing_job_ready", snap.jobId(),
                    "valid", snap.valid(), "duplicates", snap.duplicates(),
                    "failures", snap.failures(), "processed", snap.processed(), "total", snap.total()));
            case FAILED -> LOGGER.warn(logLine("processing_job_failed", snap.jobId(),
                    "errorCode", snap.errorCode(), "processed", snap.processed(), "total", snap.total()));
            case CANCELLED -> LOGGER.info(logLine("processing_job_cancelled", snap.jobId(),
                    "processed", snap.processed(), "total", snap.total()));
            default -> { }
        }
    }

    // ---- metrics ----

    private void recordCreated(final int fileCount) {
        if (meterRegistry == null) {
            return;
        }
        meterRegistry.counter("wotb_replay_processing_job_created_total").increment();
        if (fileCount > 0) {
            meterRegistry.counter("wotb_replay_processing_job_files_total").increment(fileCount);
        }
    }

    private void recordQueueWait(final long submittedNanos, final long startNanos) {
        if (meterRegistry == null) {
            return;
        }
        Timer.builder("wotb_replay_processing_job_queue_wait_seconds")
                .description("Processing Job 排队等待时长")
                .register(meterRegistry)
                .record(startNanos - submittedNanos, TimeUnit.NANOSECONDS);
    }

    private void recordTerminal(final ReplayProcessingJob.Snapshot snap, final long durationNanos) {
        if (meterRegistry == null) {
            return;
        }
        meterRegistry.counter("wotb_replay_processing_job_result_total",
                        "result", snap.status().name().toLowerCase(java.util.Locale.ROOT))
                .increment();
        Timer.builder("wotb_replay_processing_job_duration_seconds")
                .description("Processing Job 总耗时（含排队）")
                .register(meterRegistry)
                .record(durationNanos, TimeUnit.NANOSECONDS);
    }

    // ---- helpers ----

    private static String errorCodeOf(final Exception e) {
        if (e instanceof NoValidReplaysException) {
            return "NO_VALID_REPLAYS";
        }
        if (e instanceof IllegalArgumentException) {
            final String message = e.getMessage();
            if (StringUtils.hasText(message)) {
                return message;
            }
        }
        return "PROCESSING_JOB_FAILED";
    }

    private static String logLine(final String event, final String jobId, final Object... kv) {
        final StringBuilder sb = new StringBuilder("event=").append(event).append(" jobId=").append(jobId);
        for (int i = 0; i + 1 < kv.length; i += 2) {
            sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        }
        return sb.toString();
    }

    /** 协作取消 checkpoint 信号（进度回调/循环内抛出，runJob 统一转 CANCELLED）。 */
    private static final class JobCancelledException extends RuntimeException {
    }

    /** 0 场有效回放（plan §39）：终态 FAILED + NO_VALID_REPLAYS。 */
    private static final class NoValidReplaysException extends RuntimeException {
    }
}
