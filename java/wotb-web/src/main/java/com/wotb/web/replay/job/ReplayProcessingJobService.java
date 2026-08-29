package com.wotb.web.replay.job;

import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.Replays;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.ai.MapOverviewBuilder;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.mapper.Mapper;
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
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Replay Processing Job 编排（lifecycle / 进度 / 取消 / 复用 / TTL）。
 *
 * <p><b>V2 执行模型</b>：create 快速返回 202 + jobId（上传输入持久化
 * 到 job 临时目录，绝不在异步 worker 持有 {@code MultipartFile}）；真正 full processing
 * 统一交给 {@link ReplayParseScheduler}（全局并发=2、job-aware 公平、queued cancellation），
 * 每个 source 独立一个任务；全部 source 完成后由最后一个完成的 worker 单线程执行
 * deterministic FINALIZING_BATCH（去重 / League / Rating / 汇总）→ READY +
 * 内存态 ProcessedDataset（TTL 与 Job 一致）。</p>
 *
 * <p>进度语义：PROCESSING_REPLAYS 阶段逐 replay 推进
 * {@code parseCompleted/parseSucceeded/parseFailed}（真实解析完成数，与 dedupe 解耦）；
 * valid/duplicates/failures 只在 FINALIZING_BATCH 后确定。</p>
 */
@Service
public class ReplayProcessingJobService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingJobService.class);

    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayProcessingJobStore store;
    /** Replay Full Processing 唯一 CPU 预算权威（全局并发=2 + 公平）。 */
    private final ReplayParseScheduler parseScheduler;
    private final MeterRegistry meterRegistry;
    private final Tankopedia tankopedia = Tankopedia.load();

    @Autowired
    public ReplayProcessingJobService(final DefaultReplayProcessingFacade processingFacade,
                                      final ReplayProcessingJobStore store,
                                      final ReplayParseScheduler parseScheduler,
                                      @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.processingFacade = processingFacade;
        this.store = store;
        this.parseScheduler = parseScheduler;
        this.meterRegistry = meterRegistry;
    }

    // ---- create / status / cancel / result ----

    /**
     * 创建 Replay Processing Job：校验并持久化输入后把 source 任务提交给全局
     * Scheduler（有界，满载 503 PROCESSING_QUEUE_FULL）并返回 jobId（202 语义）。
     */
    public String createJob(final MultipartFile[] files) {
        return createJob(files, null);
    }

    /**
     * 创建 Replay Processing Job：{@code prioritySourceIndex} 指定用户
     * 直接点击 AI/Playback 的目标 source——Scheduler 内该 source 排到本 job 队首
     * （不突破全局并发=2），实现「目标 replay 优先解析、batch 其余继续后台解析」。
     */
    public String createJob(final MultipartFile[] files, final Integer prioritySourceIndex) {
        ReplayUploadValidator.validate(files);
        if (files.length > ReplayService.MAX_REPLAY_FILES) {
            throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
        }
        if (prioritySourceIndex != null
                && (prioritySourceIndex < 0 || prioritySourceIndex >= files.length)) {
            throw new IllegalArgumentException("SOURCE_NOT_FOUND");
        }
        final String jobId = UUID.randomUUID().toString();
        final Path inputDir = store.inputDir(jobId);
        final List<String> sourceNames = new ArrayList<>(files.length);
        try {
            Files.createDirectories(inputDir);
            int i = 0;
            for (final MultipartFile f : files) {
                final String name = f.getOriginalFilename() == null ? "replay.wotbreplay" : f.getOriginalFilename();
                final String safe = ReplayJobFiles.sanitizeFileName(name);
                f.transferTo(inputDir.resolve(i + "__" + safe));
                sourceNames.add(safe);
                i++;
            }
        } catch (final IOException e) {
            store.removeAndCleanup(jobId);
            throw new IllegalStateException("PROCESSING_JOB_STORAGE_UNAVAILABLE");
        }
        final List<Path> inputs;
        try {
            inputs = ReplayJobFiles.listInputsInOrder(inputDir);
        } catch (final IOException e) {
            store.removeAndCleanup(jobId);
            throw new IllegalStateException("PROCESSING_JOB_STORAGE_UNAVAILABLE");
        }
        final ReplayProcessingJob job = new ReplayProcessingJob(jobId, sourceNames);
        store.register(job);
        final long submittedNanos = System.nanoTime();
        final Replays.ParsedEntry[] entries = new Replays.ParsedEntry[inputs.size()];
        try {
            parseScheduler.submit(jobId, sourceOrder(prioritySourceIndex, inputs.size()),
                    index -> processSource(job, inputs.get(index), index, entries),
                    () -> onFirstDispatch(job, submittedNanos),
                    () -> finalizeJob(job, entries, submittedNanos));
        } catch (final ProcessingQueueFullException e) {
            store.removeAndCleanup(jobId);
            throw e;
        }
        recordCreated(files.length);
        LOGGER.info(logLine("processing_job_created", jobId, "files", files.length));
        return jobId;
    }

    /** 调度顺序：priority source 先于其余（其余保持上传顺序）。 */
    private static List<Integer> sourceOrder(final Integer prioritySourceIndex, final int total) {
        final List<Integer> order = new ArrayList<>(total);
        if (prioritySourceIndex != null) {
            order.add(prioritySourceIndex);
        }
        for (int i = 0; i < total; i++) {
            if (prioritySourceIndex == null || i != prioritySourceIndex) {
                order.add(i);
            }
        }
        return order;
    }

    public ReplayProcessingJob.Snapshot status(final String jobId) {
        return requireJob(jobId).snapshot();
    }

    /**
     * 取消：QUEUED 立即终态并释放 Scheduler pending 容量（{@code cancelQueued}）；
     * PROCESSING 置协作取消标志（已派发 source 完成安全 unit 后终态）。
     */
    public boolean cancel(final String jobId) {
        final ReplayProcessingJob job = requireJob(jobId);
        final boolean changed = job.requestCancel();
        if (changed) {
            final ReplayParseScheduler.CancellationResult result = parseScheduler.cancelQueued(jobId);
            if (result == ReplayParseScheduler.CancellationResult.NO_COMPLETION_PENDING) {
                // scheduler 明确不再触发 onComplete：无论 QUEUED（requestCancel
                // 已置 CANCELLED）还是 PROCESSING（requestCancel 只置 cancelRequested），
                // 都必须先把 job 推进 CANCELLED 终态，再记录 terminal observability——
                // 否则 PROCESSING 取消竞态会永久卡在 PROCESSING。markCancelled 对已
                // CANCELLED 的 QUEUED 路径幂等返回 false，无副作用。
                job.markCancelled();
                finishTerminalWithoutCompletionCallback(job);
            }
        }
        return changed;
    }

    /**
     * READY 后返回 Preview 数据（GET result 不再重新 process replay）。
     * 未 READY / 已清理返回 409 JOB_NOT_READY。
     */
    public PreviewResponse result(final String jobId) {
        final ProcessedDataset ds = readyDataset(jobId);
        return Mapper.toPreviewResponse(ds.battles(), ds.battleSourceIds(), ds.battleSourceNames(),
                ds.duplicates(), ds.failures(), tankopedia, ds.league(), ds.leagueUnavailableCode());
    }

    /**
     * Returns the current job's authoritative READY dataset for a read-only downstream analysis.
     *
     * <p>The returned dataset is shared by Preview and Export. Consumers must only derive values from
     * it; they must not enrich or mutate its Battle graph.</p>
     */
    public ProcessedDataset readyDataset(final String jobId) {
        final ReplayProcessingJob job = requireJob(jobId);
        final ReplayProcessingJob.Snapshot snap = job.snapshot();
        if (snap.status() != ReplayProcessingJob.Status.READY || job.result() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "JOB_NOT_READY");
        }
        return job.result();
    }

    private ReplayProcessingJob requireJob(final String jobId) {
        final ReplayProcessingJob job = store.get(jobId);
        if (job == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND");
        }
        return job;
    }

    // ---- Scheduler 回调 ----

    /** 第一个 source 实际派发前（QUEUED → PROCESSING + 排队时长指标）。 */
    private void onFirstDispatch(final ReplayProcessingJob job, final long submittedNanos) {
        if (!job.startProcessing()) {
            // QUEUED 期间已取消 → 终态由取消线程或 finalizeJob 处理。
            return;
        }
        recordQueueWait(submittedNanos, System.nanoTime());
        LOGGER.info(logLine("processing_job_started", job.jobId(), "total", job.total()));
    }

    /**
     * 单 source full processing（并发执行）：真实 parse 进度随完成推进，
     * per-source 状态 PROCESSING → READY|FAILED；raw byte[] 只在本次调用内存活。
     *
     * <p>任何已注册 source 处理失败都必须写入 authoritative failed
     * {@link Replays.ParsedEntry}——source 状态 / parse 计数 / ParsedEntry / final
     * failures 描述同一个 outcome；不允许用 null 表示业务失败。</p>
     */
    private void processSource(final ReplayProcessingJob job, final Path input, final int index,
                               final Replays.ParsedEntry[] entries) {
        if (job.isCancelled()) {
            return; // PROCESSING cancel：不再开始新的 full processing
        }
        final String name = ReplayJobFiles.inputName(input);
        job.markSourceProcessing(index, name);
        final Source source;
        try {
            source = new Source(name, Files.readAllBytes(input));
        } catch (final IOException e) {
            job.markSourceFailed(index, "PROCESSING_JOB_STORAGE_UNAVAILABLE");
            job.recordParseFailure();
            entries[index] = new Replays.ParsedEntry(index, name, null, "PROCESSING_JOB_STORAGE_UNAVAILABLE");
            return;
        }
        final ReplayProcessingResult result;
        try {
            result = processFullResultTracked(source);
        } catch (final Exception e) {
            final String message = e.getMessage() == null || e.getMessage().isBlank()
                    ? "REPLAY_PROCESSING_FAILED" : e.getMessage();
            job.markSourceFailed(index, message);
            job.recordParseFailure();
            entries[index] = new Replays.ParsedEntry(index, name, null, message);
            LOGGER.debug(logLine("processing_job_source_failed", job.jobId(),
                    "sourceIndex", index, "sourceName", name, "error", message));
            return;
        }
        final Battle battle = result.battle();
        // Derived artifacts：MapOverview 不可用 ≠ parse failure；
        // artifact 写失败属于存储不可用 → source FAILED（消费者依赖 artifact）。
        try {
            ReplayArtifactWriter.writeMapOverview(store.jobDir(job.jobId()), index,
                    MapOverviewBuilder.build(battle, result.reconstruction()));
            // V2 battle playback dataset：仅当 canonical timeline 可用时写出（不可用 → 跳过，
            // 容量能力不可用 → 204，绝不判 parse failure）。
            ReplayArtifactWriter.writeBattlePlaybackV2(store.jobDir(job.jobId()), index,
                    buildBattlePlaybackV2(battle, result));
            ReplayArtifactWriter.writeAiFacts(store.jobDir(job.jobId()), index, result);
        } catch (final IOException e) {
            LOGGER.warn(logLine("processing_job_artifact_write_failed", job.jobId(),
                    "sourceIndex", index, "sourceName", name), e);
            job.markSourceFailed(index, "PROCESSING_JOB_STORAGE_UNAVAILABLE");
            job.recordParseFailure();
            entries[index] = new Replays.ParsedEntry(index, name, null, "PROCESSING_JOB_STORAGE_UNAVAILABLE");
            return;
        }
        job.markSourceReady(index);
        job.recordParseSuccess();
        entries[index] = new Replays.ParsedEntry(index, name, battle, null);
    }

    /** V2 dataset 构建：canonical timeline 可用才产出；否则 null（调用方跳过，不判失败）。 */
    private static com.wotb.web.replay.dto.BattlePlaybackDataset buildBattlePlaybackV2(
            final Battle battle, final ReplayProcessingResult result) {
        if (battle == null || result == null || result.reconstruction() == null) {
            return null;
        }
        try {
            final var recorder = battle.recorderResult();
            if (recorder == null) {
                return null;
            }
            final com.wotb.core.replay.timeline.BattleTimelineResult tl =
                    com.wotb.core.replay.timeline.BattleTimelineBuilder.build(
                            battle, result.reconstruction(),
                            com.wotb.core.replay.timeline.TimelinePerspective.personal(
                                    recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
            if (!tl.usable()) {
                return null;
            }
            final var mapping = com.wotb.core.replay.processing.TeamEntityMapper.resolve(
                    battle, result.reconstruction());
            return com.wotb.web.replay.ai.BattlePlaybackProjector.project(
                    battle, tl.timeline(), mapping,
                    recorder.accountId > 0 ? recorder.accountId : null);
        } catch (final RuntimeException ex) {
            // canonical timeline 构建/投影任何运行时异常 ≠ parse failure：
            // V2 dataset 是能力增强，不可用即跳过（不判 source FAILED、不覆盖 MapOverview）。
            return null;
        }
    }

    /**
     * 全部 source 结束后单线程 deterministic 收尾：FINALIZING_BATCH →
     * 去重 / League / Rating / 汇总 → enrich → READY。取消在阶段间检查。
     */
    private void finalizeJob(final ReplayProcessingJob job, final Replays.ParsedEntry[] entries,
                             final long submittedNanos) {
        final long startNanos = System.nanoTime();
        try {
            if (job.isCancelled()) {
                job.markCancelled();
                finishTerminal(job, startNanos);
                return;
            }
            final List<Replays.ParsedEntry> list = new ArrayList<>(entries.length);
            for (int i = 0; i < entries.length; i++) {
                if (entries[i] == null) {
                    // 非 CANCELLED job：每个 sourceIndex 必须存在 terminal ParsedEntry。
                    // null 是内部 invariant violation，不是合法业务情况——绝不静默过滤。
                    throw new ProcessingJobInternalInvariantException("sourceIndex=" + i);
                }
                list.add(entries[i]);
            }
            final ReplayProcessingJob.Snapshot parseSnap = job.snapshot();
            LOGGER.info(logLine("processing_job_parse_done", job.jobId(),
                    "parseCompleted", parseSnap.parseCompleted(),
                    "parseSucceeded", parseSnap.parseSucceeded(),
                    "parseFailed", parseSnap.parseFailed(),
                    "total", job.total()));
            job.advancePhase(ReplayProcessingJob.PHASE_FINALIZING_BATCH);
            // finalize 阶段按权威 outcome 推进 duplicates/failures（conflicted 计 FAILURE、
            // Rating-ineligible 计 SUCCESS，与旧 progress 语义一致）；parse 计数不受影响。
            final int[] counters = new int[3]; // processed / duplicates / failures
            final Replays.ReplayProgressListener finalizeProgress = (sourceIndex, sourceName, outcome) -> {
                counters[0]++;
                if (outcome == Replays.Outcome.DUPLICATE) {
                    counters[1]++;
                }
                if (outcome == Replays.Outcome.FAILURE) {
                    counters[2]++;
                }
                job.updateProgress(counters[0], counters[1], counters[2]);
            };
            final LeagueReplays.LeagueCollectResult c =
                    LeagueReplays.finalize(list, null, finalizeProgress);
            if (job.isCancelled()) {
                throw new JobCancelledException();
            }
            if (c.battles().isEmpty()) {
                throw new NoValidReplaysException();
            }
            // 混合批次不再整体拒绝：League Rating 不聚合混合批次，battles 仍按
            // 普通回放语义成功返回并 READY，leagueUnavailableCode 提示 League Analysis unavailable。
            final String leagueUnavailableCode = c.mode() == LeagueRatingMode.MIXED_UNSUPPORTED
                    ? "MIXED_LEAGUE_AND_STANDARD_REPLAYS" : null;
            // 事实层 enrich 一次：Preview / Export 直接消费已 enrich 的 authoritative Battle。
            for (final Battle battle : c.battles()) {
                PerformanceMetricsCalculator.populateBattle(battle);
            }
            if (c.mode() == LeagueRatingMode.LEAGUE_RATING) {
                job.markReady(new ProcessedDataset(c.battles(), c.battleSourceNames(), c.battleSourceIds(),
                        c.duplicates(), c.failures(), c.leagueBatch(), null));
            } else {
                job.markReady(new ProcessedDataset(c.battles(), c.battleSourceNames(), c.battleSourceIds(),
                        c.duplicates(), c.failures(), null, leagueUnavailableCode));
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

    /** 与 preview/export 完全相同的 authoritative full processing 链（禁止 raw parse 回归）。 */
    private ReplayProcessingResult processFullResult(final Source source) {
        final ReplayProcessingResult result = processingFacade.process(source, ReplayProcessingOptions.full());
        if (meterRegistry != null) {
            // full processing 计数器（验证 1 replay → Preview/AI/Playback/Export = +1）
            meterRegistry.counter("wotb_replay_full_processing_total").increment();
        }
        if (result.battle() == null) {
            final String message = result.error() != null && StringUtils.hasText(result.error().message())
                    ? result.error().message() : "REPLAY_PROCESSING_FAILED";
            throw new IllegalArgumentException(message);
        }
        return result;
    }

    /** 单文件处理 + 逐文件耗时指标（低基数，无 filename tag）。 */
    private ReplayProcessingResult processFullResultTracked(final Source source) {
        if (meterRegistry == null) {
            return processFullResult(source);
        }
        final Timer.Sample sample = Timer.start(meterRegistry);
        try {
            return processFullResult(source);
        } finally {
            sample.stop(Timer.builder("wotb_replay_processing_file_duration_seconds")
                    .description("单个 replay full processing 耗时")
                    .publishPercentileHistogram()
                    .register(meterRegistry));
        }
    }

    /** 终态收尾（idempotent）：日志 + 指标；终态保留到 TTL（store sweeper 清理）。 */
    private void finishTerminal(final ReplayProcessingJob job, final long startNanos) {
        if (!job.markTerminalRecorded()) {
            return;
        }
        final ReplayProcessingJob.Snapshot snap = job.snapshot();
        logTerminal(snap);
        recordTerminal(snap, System.nanoTime() - startNanos);
    }

    /**
     * 无 completion callback 的终态收尾（QUEUED 取消 / PROCESSING 取消竞态中
     * scheduler 返回 NO_COMPLETION_PENDING 时）：onComplete 永不触发、worker 不会
     * 调用 finishTerminal，由请求线程记录 terminal observability（exactly once）。
     */
    private void finishTerminalWithoutCompletionCallback(final ReplayProcessingJob job) {
        if (!job.markTerminalRecorded()) {
            return;
        }
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
        if (e instanceof ProcessingJobInternalInvariantException) {
            return "PROCESSING_JOB_INTERNAL_INVARIANT";
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

    /** 协作取消 checkpoint 信号（finalize 阶段间检查，统一转 CANCELLED）。 */
    private static final class JobCancelledException extends RuntimeException {
    }

    /**
     * 内部不变式违例：非 CANCELLED job 的某个 sourceIndex 缺少 terminal ParsedEntry。
     * 视为编程错误而非业务情况——finalize 直接 FAILED + PROCESSING_JOB_INTERNAL_INVARIANT。
     */
    private static final class ProcessingJobInternalInvariantException extends RuntimeException {
        ProcessingJobInternalInvariantException(final String detail) {
            super("missing terminal ParsedEntry for " + detail);
        }
    }

    /** 0 场有效回放：终态 FAILED + NO_VALID_REPLAYS。 */
    private static final class NoValidReplaysException extends RuntimeException {
    }
}
