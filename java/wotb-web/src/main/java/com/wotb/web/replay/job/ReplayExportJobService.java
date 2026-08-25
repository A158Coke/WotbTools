package com.wotb.web.replay.job;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.parse.Replays;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.PotentialDamage;
import com.wotb.web.replay.ReplayExportNames;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replay.service.ReplayService;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Replay Export Job 编排（异步长任务：bounded worker + 有界队列 + 真实进度 + 终态 exactly once）。
 *
 * <p>Create（request 线程）：校验 → 把上传输入持久化到 job 临时目录（绝不在异步
 * worker 持有 {@code MultipartFile}——request 生命周期结束即释放）→ 注册 job →
 * 提交有界 worker 池 → 202。Worker：batch 内 replay 保持上传顺序串行；执行前获取
 * 全局 {@link ReplayCapacityLimiter} 许可（max-concurrent-jobs 不因 job 化提高）→
 * 逐文件 full processing（与 preview 同一 authoritative 链）→ 真实进度 →
 * XLSX/ZIP 写入流式 artifact（不 ByteArrayOutputStream 全量驻留）→ READY。
 * metadata-only 不适用：本服务只处理导出，失败/取消按失败/取消语义终态。</p>
 */
@Service
public class ReplayExportJobService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayExportJobService.class);

    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String ZIP_MIME = "application/zip";

    private final ReplayCapacityLimiter capacityLimiter;
    private final DefaultReplayProcessingFacade processingFacade;
    private final ExportJobStore store;
    private final ReplayExportWorkerExecutor workerExecutor;
    private final MeterRegistry meterRegistry;
    /** Processing Job result 提供方（复用路径：Export 直接消费已解析 result；null = 传统上传路径）。 */
    private final ReplayProcessingJobStore processingStore;
    private final Tankopedia tankopedia = Tankopedia.load();

    @Autowired
    public ReplayExportJobService(final ReplayCapacityLimiter capacityLimiter,
                                  final DefaultReplayProcessingFacade processingFacade,
                                  final ExportJobStore store,
                                  final ReplayExportWorkerExecutor workerExecutor,
                                  final ReplayProcessingJobStore processingStore,
                                  @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.capacityLimiter = capacityLimiter;
        this.processingFacade = processingFacade;
        this.store = store;
        this.workerExecutor = workerExecutor;
        this.processingStore = processingStore;
        this.meterRegistry = meterRegistry;
    }

    /** 测试便利构造器（无 Processing result 复用能力）。 */
    public ReplayExportJobService(final ReplayCapacityLimiter capacityLimiter,
                                  final DefaultReplayProcessingFacade processingFacade,
                                  final ExportJobStore store,
                                  final ReplayExportWorkerExecutor workerExecutor,
                                  @Autowired(required = false) final MeterRegistry meterRegistry) {
        this(capacityLimiter, processingFacade, store, workerExecutor, null, meterRegistry);
    }

    // ---- create / status / cancel / download ----

    /**
     * 创建 Export Job：校验并持久化输入后返回 jobId（202 语义）。
     * 队列满载抛 {@link ExportQueueFullException}（503 EXPORT_QUEUE_FULL）。
     */
    public String createJob(final MultipartFile[] files, final String mode) {
        return createJob(files, mode, null);
    }

    /** 创建 Export Job（带战队名称覆盖 JSON：{battle:{arenaId:team:名}, summary:{teamKey:名}}，仅本次调用内使用）。 */
    public String createJob(final MultipartFile[] files, final String mode,
                            final String processingJobId, final String teamNamesJson) {
        return createJob(files, mode, processingJobId, parseTeamNames(teamNamesJson));
    }

    /**
     * 解析战队名称覆盖 JSON（单场 battle + 批次 teamKey 两种独立 identity）：
     * <pre>
     * {"battle":  {"arenaId:team": "名", ...}, "summary": {"teamKey": "名", ...}}
     * </pre>
     * 结构化格式优先；扁平 {@code {arenaId:team: 名}} 向后兼容视为 battle override。
     * 非法/缺失 → 空（null safe，不 500）；覆盖只影响显示名，不影响 Rating 数值，不持久化。
     */
    static TeamNameOverrides parseTeamNames(final String json) {
        if (json == null || json.isBlank()) {
            return TeamNameOverrides.empty();
        }
        try {
            final tools.jackson.databind.ObjectMapper om = tools.jackson.databind.json.JsonMapper.builder().build();
            final tools.jackson.databind.JsonNode node = om.readTree(json);
            if (node == null || !node.isObject()) {
                return TeamNameOverrides.empty();
            }
            final Map<String, String> battle = new java.util.LinkedHashMap<>();
            final Map<String, String> summary = new java.util.LinkedHashMap<>();
            final tools.jackson.databind.JsonNode battleNode = node.get("battle");
            final tools.jackson.databind.JsonNode summaryNode = node.get("summary");
            if ((battleNode != null && battleNode.isObject())
                    || (summaryNode != null && summaryNode.isObject())) {
                collectText(battleNode, battle);
                collectText(summaryNode, summary);
                return new TeamNameOverrides(battle, summary);
            }
            // 向后兼容：扁平 {arenaId:team: name} → battle override
            collectText(node, battle);
            return new TeamNameOverrides(battle, Map.of());
        } catch (final Exception e) {
            return TeamNameOverrides.empty();
        }
    }

    private static void collectText(final tools.jackson.databind.JsonNode node,
                                    final Map<String, String> out) {
        if (node == null || !node.isObject()) {
            return;
        }
        for (final var e : node.properties()) {
            if (e.getValue().isTextual()) {
                out.put(e.getKey(), e.getValue().asText());
            }
        }
    }

    /**
     * 创建 Export Job。
     *
     * <p>{@code processingJobId} 非 null = <b>复用 Replay Processing Job result</b>
     * （复用路径）：不再重新上传 replay、不再 processFull，worker 直接从已解析的
     * {@link ProcessedDataset} 生成 XLSX/ZIP；Export 创建时对 Processing result
     * acquire 引用（引用计数阻止其被 TTL 清理）。null = 传统 multipart 上传路径。</p>
     *
     * @throws ResponseStatusException 404 PROCESSING_JOB_NOT_FOUND / 409 PROCESSING_JOB_NOT_READY
     *         （复用路径引用不存在的 / 未 READY 的 Processing Job）
     */
    public String createJob(final MultipartFile[] files, final String mode, final String processingJobId) {
        return createJob(files, mode, processingJobId, (TeamNameOverrides) null);
    }

    private String createJob(final MultipartFile[] files, final String mode, final String processingJobId,
                             final TeamNameOverrides teamNames) {
        final boolean each = "each".equalsIgnoreCase(mode);
        final ReplayProcessingJob processingJob;
        // acquire 成功后为 true（Processing result 引用 +1，引用所有权生命周期）。
        final boolean acquired;
        if (StringUtils.hasText(processingJobId)) {
            if (processingStore == null) {
                throw new IllegalStateException("PROCESSING_STORE_UNAVAILABLE");
            }
            final ReplayProcessingJob acquiredJob = processingStore.acquireForExport(processingJobId);
            if (acquiredJob == null) {
                final ReplayProcessingJob existing = processingStore.get(processingJobId);
                if (existing == null) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROCESSING_JOB_NOT_FOUND");
                }
                throw new ResponseStatusException(HttpStatus.CONFLICT, "PROCESSING_JOB_NOT_READY");
            }
            processingJob = acquiredJob;
            acquired = true;
        } else {
            processingJob = null;
            acquired = false;
            ReplayUploadValidator.validate(files);
            if (files.length > ReplayService.MAX_REPLAY_FILES) {
                throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
            }
        }
        final String jobId = UUID.randomUUID().toString();
        final int total;
        if (processingJob != null) {
            final ProcessedDataset ds = processingJob.result();
            // total = Processing 输入总数（valid + duplicates + failures），保持与解析时一致。
            total = ds.validCount() + ds.duplicates().size() + ds.failures().size();
        } else {
            total = files.length;
        }
        final Path inputDir = store.inputDir(jobId);
        // Processing result 引用所有权：acquire 成功后，任何在 worker 正式
        // 接手前的失败（job 目录创建 / register / submit rejection）都必须 release——否则 refcount
        // 永久泄漏，ReplayProcessingJobStore TTL sweeper 永远跳过该 dataset（heap 永久驻留）。
        // worker submit 成功即 ownershipTransferred=true，此后 release 由 worker 终态
        // （runJobFromResult finally）或 QUEUED remove 取消（cancel 请求线程）负责，exactly once。
        boolean ownershipTransferred = false;
        try {
            if (processingJob == null) {
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
                    throw new IllegalStateException("EXPORT_JOB_STORAGE_UNAVAILABLE");
                }
            } else {
                // 复用路径无上传输入，但 job 目录需要存在（artifact 写入目标）。
                try {
                    Files.createDirectories(inputDir);
                } catch (final IOException e) {
                    store.removeAndCleanup(jobId);
                    throw new IllegalStateException("EXPORT_JOB_STORAGE_UNAVAILABLE");
                }
            }
            final ExportJob job = new ExportJob(jobId, each ? "each" : "aggregate", total, processingJobId, teamNames);
            store.register(job);
            final long submittedNanos = System.nanoTime();
            try {
                if (processingJob != null) {
                    workerExecutor.submit(jobId, () -> runJobFromResult(job, processingJob, each, submittedNanos));
                } else {
                    workerExecutor.submit(jobId, () -> runJob(job, inputDir, each, submittedNanos));
                }
            } catch (final RejectedExecutionException e) {
                store.removeAndCleanup(jobId);
                throw new ExportQueueFullException();
            }
            ownershipTransferred = true;
            LOGGER.info(logLine("export_job_created", jobId, "mode", job.mode(), "total", total,
                    "processingJobId", processingJobId));
            return jobId;
        } finally {
            if (acquired && !ownershipTransferred) {
                // worker 未接手：本线程仍持有引用，必须释放（exactly once——worker 成功接手后
                // 本分支不再执行，release 由 worker 终态 / QUEUED 取消路径负责，不 double-release）。
                processingStore.release(processingJobId);
            }
        }
    }

    public ExportJob.Snapshot status(final String jobId) {
        final ExportJob job = requireJob(jobId);
        return job.snapshot();
    }

    /**
     * 取消：QUEUED 立即终态并真正释放 executor queue slot（{@code removeQueued} 把尚未执行
     * 的任务从有界队列移除，新 job 可立即使用该容量）；PROCESSING 协作取消（worker checkpoint
     * 后终态）。dequeue/cancel 竞争：任务已 dequeue/开始执行时 remove 返回 false，worker 经
     * checkpoint 识别 cancelRequested 后终态，绝不再执行已取消的 queued 任务。
     */
    public boolean cancel(final String jobId) {
        final ExportJob job = requireJob(jobId);
        final boolean changed = job.requestCancel();
        if (changed) {
            final boolean removed = workerExecutor.removeQueued(jobId);
            if (removed) {
                // QUEUED 任务已被从 executor queue 移除、Runnable 永不执行 → worker 不会调用
                // finishTerminal；在请求线程直接记录终态 observability（exactly once），
                // 并释放对 Processing result 的引用（worker 不会运行来 release）。
                if (job.processingJobId() != null && processingStore != null) {
                    processingStore.release(job.processingJobId());
                }
                finishTerminalQueuedCancel(job);
            }
        }
        return changed;
    }

    /** READY 后返回 artifact 资源（streaming 下载，不 readAllBytes）。 */
    public Resource download(final String jobId) {
        final ExportJob job = requireJob(jobId);
        final ExportJob.Snapshot snap = job.snapshot();
        if (snap.status() != ExportJob.Status.READY || job.artifactPath() == null
                || !Files.exists(job.artifactPath())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "JOB_NOT_READY");
        }
        return new FileSystemResource(job.artifactPath());
    }

    private ExportJob requireJob(final String jobId) {
        final ExportJob job = store.get(jobId);
        if (job == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND");
        }
        return job;
    }

    // ---- worker 执行 ----

    private void runJob(final ExportJob job, final Path inputDir, final boolean each, final long submittedNanos) {
        final long startNanos = System.nanoTime();
        recordQueueWait(submittedNanos, startNanos, job.mode());
        try {
            if (!job.startProcessing()) {
                // QUEUED 期间被取消 → 已终态 CANCELLED；worker 负责清理与终态统计。
                finishTerminal(job, startNanos);
                return;
            }
            if (job.isCancelled()) {
                job.markCancelled();
                finishTerminal(job, startNanos);
                return;
            }
            LOGGER.info(logLine("export_job_started", job.jobId(), "mode", job.mode(), "total", job.total()));
            // 全局 replay 容量仍然生效：job 化不绕过 max-concurrent-jobs=2。
            capacityLimiter.acquire();
            try {
                processJob(job, inputDir, each);
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
            // 未预期 JVM 级错误（类加载失败等）也必须终态，绝不把 job 留在 PROCESSING。
            LOGGER.error(logLine("export_job_aborted", job.jobId(), "error", e.getClass().getSimpleName()), e);
            if (job.isCancelled()) {
                job.markCancelled();
            } else {
                job.markFailed("EXPORT_JOB_FAILED");
            }
            finishTerminal(job, startNanos);
        }
    }

    /**
     * 复用 Processing Job result 的 Export worker：不重新上传、
     * 不 processFull，直接从已解析的 {@link ProcessedDataset} 生成 artifact；
     * 无 replay processing，故不获取全局 replay 容量许可。终态后 release
     * Processing result 引用（计数保护，防 TTL 清理）。
     */
    private void runJobFromResult(final ExportJob job, final ReplayProcessingJob processingJob,
                                   final boolean each, final long submittedNanos) {
        final long startNanos = System.nanoTime();
        recordQueueWait(submittedNanos, startNanos, job.mode());
        // 方法作用域：失败日志需要 dataset 上下文（parsed/rated/duplicates/league failures）
        final ProcessedDataset ds = processingJob.result();
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
            LOGGER.info(logLine("export_job_started", job.jobId(), "mode", job.mode(), "total", job.total(),
                    "reuse_processing_job", processingJob.jobId()));
            if (each) {
                processEachFromResult(job, ds);
            } else {
                processAggregateFromResult(job, ds);
            }
            finishTerminal(job, startNanos);
        } catch (final JobCancelledException e) {
            job.markCancelled();
            finishTerminal(job, startNanos);
        } catch (final Exception e) {
            if (job.isCancelled()) {
                job.markCancelled();
            } else {
                // 结构化失败上下文（安全字段：无 replay 二进制 / Authorization / token）：
                // mode / reuse / processing job 状态 / parsed / rated / duplicates / league failures
                LOGGER.warn(logLine("export_job_failed_detail", job.jobId(),
                        "mode", job.mode(),
                        "reuse_processing_job", processingJob.jobId(),
                        "processing_job_status", processingJob.snapshot().status().name(),
                        "parsed_battles", ds.battles().size(),
                        "rated_battles", ds.isLeague() ? ds.league().battleResults().size() : 0,
                        "duplicates", ds.duplicates().size(),
                        "league_failures", ds.isLeague() ? ds.league().failures().size() : 0,
                        "error", e.getClass().getSimpleName(),
                        "message", String.valueOf(e.getMessage())), e);
                job.markFailed(errorCodeOf(e));
            }
            finishTerminal(job, startNanos);
        } catch (final Error e) {
            LOGGER.error(logLine("export_job_aborted", job.jobId(), "error", e.getClass().getSimpleName()), e);
            if (job.isCancelled()) {
                job.markCancelled();
            } else {
                job.markFailed("EXPORT_JOB_FAILED");
            }
            finishTerminal(job, startNanos);
        } finally {
            // Export 终态（含取消/失败）后释放引用，允许 Processing result 被 TTL 清理。
            if (processingStore != null) {
                processingStore.release(processingJob.jobId());
            }
        }
    }

    /**
     * aggregate：直接复用已 enrich 的 battles 生成汇总 XLSX（无任何 replay processing 步骤，
     * 只读消费 {@link ProcessedDataset}：不再次 PotentialDamage / populateBattle
     * / 任何会 mutate 共享 Battle 的 enrichment——enrich 由 Processing Job
     * 创建 dataset 前保证（ReplayProcessingJobService.processJob）。
     */
    private void processAggregateFromResult(final ExportJob job, final ProcessedDataset ds) throws Exception {
        final List<Battle> battles = ds.battles();
        if (ds.validCount() <= 0) {
            throw new NoValidReplaysException();
        }
        job.updateProgress(ds.validCount() + ds.duplicates().size() + ds.failures().size(),
                ds.duplicates().size(), ds.failures().size());
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        job.advancePhase(ExportJob.Phase.BUILDING_EXCEL);
        final String filename = battles.size() == 1
                ? ReplayJobFiles.stripExt(ds.battleSourceNames().getFirst()) + ".xlsx"
                : (ds.isLeague() ? ReplayExportNames.LEAGUE_AGGREGATE : ReplayExportNames.STANDARD_AGGREGATE);
        final Path artifact = store.jobDir(job.jobId()).resolve("result.xlsx");
        job.trackArtifact(artifact);
        try (OutputStream out = Files.newOutputStream(artifact)) {
            if (ds.isLeague()) {
                // League Rating：与 preview 同一 core；战队名称覆盖仅本次调用内使用
                if (battles.size() == 1) {
                    // identity 绑定；未评分单场回退普通单场工作簿（基础数据仍可导出）
                    final LeagueRatingResult single =
                            ds.league().resultFor(battles.getFirst().arenaId);
                    if (single != null) {
                        ExcelExporter.writeSingleLeague(battles.getFirst(), single, tankopedia,
                                job.teamNames().battle(), out);
                    } else {
                        ExcelExporter.writeSingle(battles.getFirst(), tankopedia, out);
                    }
                } else {
                    ExcelExporter.writeAggregateLeague(battles, ds.battleSourceNames(),
                            ds.duplicates(), ds.league(), tankopedia,
                            job.teamNames().battle(), job.teamNames().summary(), out);
                }
            } else if (battles.size() == 1) {
                ExcelExporter.writeSingle(battles.getFirst(), tankopedia, out);
            } else {
                ExcelExporter.writeAggregate(battles, ds.battleSourceNames(), ds.duplicates(), tankopedia, out);
            }
        }
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        job.markReady(filename, XLSX_MIME, artifact);
    }

    /**
     * each：逐场把已解析 XLSX 写入 ZIP entry（Battle 来自 Processing result，已 enrich）。
     * 只读消费 {@link ProcessedDataset}，不再次 enrichment。
     * progress 逐场推进（processed 最终 = valid + duplicates + failures = total）。
     *
     * <p><b>valid 语义</b>：{@code ds.battles()} 本身就是 Processing 阶段
     * 已排除 duplicates/failures 后的有效场；只要 validCount &gt; 0 就允许生成 ZIP。
     * failures 只用于进度与终态统计，绝不能再与 processed 相减（否则 1 valid + 1 failure
     * 会被误判为 NO_VALID_REPLAYS）。</p>
     */
    private void processEachFromResult(final ExportJob job, final ProcessedDataset ds) throws Exception {
        job.advancePhase(ExportJob.Phase.BUILDING_ARCHIVE);
        final Path artifact = store.jobDir(job.jobId()).resolve("result.zip");
        job.trackArtifact(artifact);
        final Set<String> usedNames = new HashSet<>();
        final List<Battle> battles = ds.battles();
        final int duplicates = ds.duplicates().size();
        final int failures = ds.failures().size();
        int processed = 0;
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(artifact), StandardCharsets.UTF_8)) {
            for (int i = 0; i < battles.size(); i++) {
                // 安全 checkpoint：每个 replay 开始前。
                if (job.isCancelled()) {
                    throw new JobCancelledException();
                }
                processed++;
                // Replay parse success 与 Rating eligibility 是两个独立领域：解析成功但
                // Rating-ineligible 的 CW 场次同样导出（标准单场工作簿，Replay facts 保留），
                // 不得因未评分把已解析回放从 ZIP 中丢弃。
                final LeagueRatingResult leagueResult =
                        ds.isLeague() ? ds.league().resultFor(battles.get(i).arenaId) : null;
                // Battle 已成功（Processing 阶段完成）；此处任何写入失败 → 整个 job FAILED
                // （边界：artifact generation failure 不得误判为单场失败）。
                final ZipEntry entry = new ZipEntry(uniqueName(
                        ReplayJobFiles.stripExt(ds.battleSourceNames().get(i)) + ".xlsx", usedNames));
                zip.putNextEntry(entry);
                if (leagueResult != null) {
                    writeSingleLeagueExcel(battles.get(i), leagueResult, job.teamNames().battle(), zip);
                } else {
                    writeSingleExcel(battles.get(i), zip);
                }
                zip.closeEntry();
                job.updateProgress(processed, duplicates, failures);
            }
        }
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        if (ds.validCount() <= 0) {
            throw new NoValidReplaysException();
        }
        // duplicates/failures 已在 Processing 阶段处理，此处计入最终 processed（保证 processed == total）。
        job.updateProgress(processed + duplicates + failures, duplicates, failures);
        job.markReady("逐场导出.zip", ZIP_MIME, artifact);
    }

    /** 终态收尾（exactly once 由 job 状态机保证）：日志 + 指标；FAILED/CANCELLED 删除 partial artifact（不暴露半包）。 */
    private void finishTerminal(final ExportJob job, final long startNanos) {
        final ExportJob.Snapshot snap = job.snapshot();
        if (snap.status() != ExportJob.Status.READY) {
            deleteArtifact(job);
        }
        logTerminal(snap);
        recordTerminal(snap, System.nanoTime() - startNanos, snap.mode());
        // 终态（含 FAILED/CANCELLED）统一保留到 TTL，让前端能读到终态错误码；
        // 物理清理（输入 + artifact）由 ExportJobStore 的 TTL sweeper 完成。
    }

    /**
     * QUEUED 取消的终态收尾：任务已被 {@code removeQueued} 移除、Runnable 永不执行，
     * worker 不会走到 {@link #finishTerminal}，因此由请求线程直接记录 terminal
     * observability。exactly once：{@code requestCancel} 成功且 {@code removeQueued}
     * 为 true 的组合恰好发生一次，PROCESSING 协作取消仍由 worker 的 finishTerminal 记录，
     * 不会重复。duration 按「创建 → 取消」计（无 worker 运行时长）。
     */
    private void finishTerminalQueuedCancel(final ExportJob job) {
        final ExportJob.Snapshot snap = job.snapshot();
        logTerminal(snap);
        recordTerminal(snap,
                TimeUnit.MILLISECONDS.toNanos(System.currentTimeMillis() - job.createdAtMillis()), snap.mode());
    }

    private void logTerminal(final ExportJob.Snapshot snap) {
        switch (snap.status()) {
            case READY -> LOGGER.info(logLine("export_job_ready", snap.jobId(),
                    "mode", snap.mode(), "filename", snap.filename(), "duplicates", snap.duplicates(),
                    "failures", snap.failures(), "processed", snap.processed(), "total", snap.total()));
            case FAILED -> LOGGER.warn(logLine("export_job_failed", snap.jobId(),
                    "errorCode", snap.errorCode(), "processed", snap.processed(), "total", snap.total()));
            case CANCELLED -> LOGGER.info(logLine("export_job_cancelled", snap.jobId(),
                    "processed", snap.processed(), "total", snap.total()));
            default -> { }
        }
    }

    private void processJob(final ExportJob job, final Path inputDir, final boolean each) throws Exception {
        final List<Path> inputs = ReplayJobFiles.listInputsInOrder(inputDir);
        if (each) {
            processEach(job, inputs);
        } else {
            processAggregate(job, inputs);
        }
    }

    /** aggregate：LeagueReplays.collect 去重/模式判定 + 逐文件进度；batch 内串行处理。 */
    private void processAggregate(final ExportJob job, final List<Path> inputs) throws Exception {
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
            LOGGER.debug(logLine("export_job_progress", job.jobId(), "processed", counters[0],
                    "duplicates", counters[1], "failures", counters[2], "total", job.total()));
            // 安全 checkpoint：每个 replay 完成后检查取消。
            if (job.isCancelled()) {
                throw new JobCancelledException();
            }
        };
        final LeagueReplays.LeagueCollectResult c = LeagueReplays.collect(
                ReplayJobFiles.lazySources(inputs), this::processFull, null, progress);
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        // 混合批次按普通回放语义导出（standard export 不依赖 League eligibility）
        if (c.battles().isEmpty()) {
            throw new NoValidReplaysException();
        }
        PotentialDamage.apply(c.battles(), tankopedia);
        // 单场 Performance Metrics 回填（League 单场工作簿含 contribution/kast/impact；
        // from-result 路径的 dataset 已在创建时 enrich）
        for (final Battle battle : c.battles()) {
            PerformanceMetricsCalculator.populateBattle(battle);
        }
        job.advancePhase(ExportJob.Phase.BUILDING_EXCEL);
        final String filename = c.battles().size() == 1
                ? ReplayJobFiles.stripExt(c.battleSourceNames().getFirst()) + ".xlsx"
                : ReplayExportNames.aggregate(c.mode());
        final Path artifact = store.jobDir(job.jobId()).resolve("result.xlsx");
        job.trackArtifact(artifact);
        try (OutputStream out = Files.newOutputStream(artifact)) {
            if (c.mode() == LeagueRatingMode.LEAGUE_RATING) {
                // League Rating：复用同一评分 core + 单场 Performance Metrics
                if (c.battles().size() == 1) {
                    // identity 绑定；未评分单场回退普通单场工作簿
                    final LeagueRatingResult single =
                            c.leagueBatch().resultFor(c.battles().getFirst().arenaId);
                    if (single != null) {
                        ExcelExporter.writeSingleLeague(c.battles().getFirst(), single, tankopedia,
                                job.teamNames().battle(), out);
                    } else {
                        ExcelExporter.writeSingle(c.battles().getFirst(), tankopedia, out);
                    }
                } else {
                    ExcelExporter.writeAggregateLeague(c.battles(), c.battleSourceNames(),
                            c.duplicates(), c.leagueBatch(), tankopedia,
                            job.teamNames().battle(), job.teamNames().summary(), out);
                }
            } else {
                // 单场 Performance Metrics 已在上方统一回填（与 League 分支同一 authoritative
                // enrichment，只执行一次——processFull → PotentialDamage → populateBattle → renderer）
                if (c.battles().size() == 1) {
                    ExcelExporter.writeSingle(c.battles().getFirst(), tankopedia, out);
                } else {
                    ExcelExporter.writeAggregate(c.battles(), c.battleSourceNames(), c.duplicates(), tankopedia, out);
                }
            }
        }
        job.markReady(filename, XLSX_MIME, artifact);
    }

    /**
     * each：逐场独立 full processing，每场立即把 XLSX 写入 ZIP entry 后释放该 Battle——
     * working set 为 O(1)（不再全批次保留 {@code List<Battle>}）：
     * <pre>
     * input replay → processFull → enrich → metrics → write xlsx into zip → release Battle → next replay
     * </pre>
     * 全程 phase = BUILDING_ARCHIVE（从第一场起就在写 ZIP，UI 不显示假的「全部解析完才开始生成」）。
     *
     * <p><b>异常边界</b>：两个边界严格分离——
     * <ul>
     * <li><b>replay processing failure</b>（processFull / reconstruction / NO_BATTLE_DATA /
     *     单场 enrichment）：只说明「该场无效」→ {@code failures++} 并跳过，继续后续 replay；</li>
     * <li><b>artifact generation failure</b>（Battle 已成功，后续 zip entry / POI /
     *     filesystem / OutputStream 任何失败）：意味着 ZIP 可能已损坏 → 整个 job FAILED，
     *     绝不继续写、绝不 READY；partial artifact 由 finishTerminal 删除（不暴露半包）。</li>
     * </ul></p>
     * 取消时 partial zip 同样由 finishTerminal 删除，不暴露半包。
     */
    private void processEach(final ExportJob job, final List<Path> inputs) throws Exception {
        job.advancePhase(ExportJob.Phase.BUILDING_ARCHIVE);
        final Path artifact = store.jobDir(job.jobId()).resolve("result.zip");
        job.trackArtifact(artifact);
        final Set<String> usedNames = new HashSet<>();
        final LeagueReplays.LeagueCollectResult league = eachLeagueResult(inputs);
        if (league != null) {
            processEachLeague(job, league, artifact, usedNames);
            return;
        }
        int processed = 0;
        int failures = 0;
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(artifact), StandardCharsets.UTF_8)) {
            for (final Path p : inputs) {
                // 安全 checkpoint：每个 replay 开始前。
                if (job.isCancelled()) {
                    throw new JobCancelledException();
                }
                processed++;
                final Battle battle;
                try {
                    // 边界 1（replay processing failure）：该 replay 无效 → skip + failures++。
                    battle = processFull(new Source(ReplayJobFiles.inputName(p), Files.readAllBytes(p)));
                    if (battle == null) {
                        throw new IllegalArgumentException("NO_BATTLE_DATA");
                    }
                    PotentialDamage.apply(List.of(battle), tankopedia);
                    PerformanceMetricsCalculator.populateBattle(battle);
                } catch (final Exception e) {
                    failures++;
                    LOGGER.debug(logLine("export_job_replay_failed", job.jobId(),
                            "replay", ReplayJobFiles.inputName(p), "error", String.valueOf(e.getMessage())));
                    progressCheckpoint(job, processed, failures);
                    continue;
                }
                // 边界 2（artifact generation failure）：Battle 已成功，任何写入失败 → 整个 job FAILED。
                final ZipEntry entry = new ZipEntry(uniqueName(ReplayJobFiles.stripExt(ReplayJobFiles.inputName(p)) + ".xlsx", usedNames));
                zip.putNextEntry(entry);
                writeSingleExcel(battle, zip);
                zip.closeEntry();
                progressCheckpoint(job, processed, failures);
            }
        }
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        if (processed - failures <= 0) {
            throw new NoValidReplaysException();
        }
        job.markReady("逐场导出.zip", ZIP_MIME, artifact);
    }

    /**
     * mode=each 的模式预扫描：读取每个文件 meta.json#arenaBonusType 判定批次模式。
     * 返回 null = 普通/混合模式（沿用逐文件流式路径；混合批次 League Analysis unavailable，
     * 按普通回放逐场导出）；仅当整批都是 league 时返回 League 收集结果。
     */
    private LeagueReplays.LeagueCollectResult eachLeagueResult(final List<Path> inputs) throws Exception {
        boolean anyLeague = false;
        boolean anyStandard = false;
        for (final Path p : inputs) {
            final Integer abt;
            try {
                abt = ReplayParser.peekArenaBonusType(Files.readAllBytes(p));
            } catch (final Exception e) {
                continue; // 解析失败文件不参与模式判定（按既有失败策略跳过）
            }
            if (LeagueRatingMode.isLeague(abt)) {
                anyLeague = true;
            } else if (abt != null) {
                anyStandard = true;
            }
        }
        if (!anyLeague || anyStandard) {
            return null;
        }
        return LeagueReplays.collect(ReplayJobFiles.lazySources(inputs), this::processFull, null, null);
    }

    /**
     * League mode=each：每场一个 XLSX——已评分场次 → League 单场工作簿；解析成功但
     * Rating-ineligible（resultFor=null）→ 标准单场工作簿（Replay facts / Performance
     * Metrics 保留，不跳过、不计入 failures）；真正解析失败/冲突的场次在 collect 阶段
     * 已按失败语义排除。Rating 按 arenaId identity 绑定。
     */
    private void processEachLeague(final ExportJob job, final LeagueReplays.LeagueCollectResult c,
                                   final Path artifact, final Set<String> usedNames) throws Exception {
        int processed = 0;
        int exported = 0;
        // League each：不执行 PotentialDamage enrichment（League 单场工作簿已过滤
        // Potential Damage family——该指标对当前 League Analysis 无业务价值）；
        // 仍回填单场 Performance Metrics（Contribution/KAST/Impact 是有效 League 数据）。
        for (final Battle battle : c.battles()) {
            PerformanceMetricsCalculator.populateBattle(battle);
        }
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(artifact), StandardCharsets.UTF_8)) {
            for (int i = 0; i < c.battles().size(); i++) {
                if (job.isCancelled()) {
                    throw new JobCancelledException();
                }
                processed++;
                final Battle battle = c.battles().get(i);
                final LeagueRatingResult result = c.leagueBatch().resultFor(battle.arenaId);
                final ZipEntry entry = new ZipEntry(uniqueName(
                        ReplayJobFiles.stripExt(c.battleSourceNames().get(i)) + ".xlsx", usedNames));
                zip.putNextEntry(entry);
                if (result != null) {
                    writeSingleLeagueExcel(battle, result, job.teamNames().battle(), zip);
                } else {
                    writeSingleExcel(battle, zip);
                }
                zip.closeEntry();
                exported++;
                progressCheckpoint(job, processed, 0);
            }
        }
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        if (exported <= 0) {
            throw new NoValidReplaysException();
        }
        job.markReady("逐场导出.zip", ZIP_MIME, artifact);
    }

    /** 进度推进 + 协作取消 checkpoint（每个 replay 成功/失败后各恰好一次）。 */
    private void progressCheckpoint(final ExportJob job, final int processed, final int failures) {
        job.updateProgress(processed, 0, failures);
        LOGGER.debug(logLine("export_job_progress", job.jobId(), "processed", processed,
                "duplicates", 0, "failures", failures, "total", job.total()));
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
    }

    /**
     * 单场 XLSX 写入输出流（ZIP entry 流）。
     * 独立方法 = 最小测试 seam（测试子类可注入 artifact 写失败，
     * 无需为静态 {@link ExcelExporter} 建立大型抽象）。
     */
    void writeSingleExcel(final Battle battle, final OutputStream out) throws IOException {
        ExcelExporter.writeSingle(battle, tankopedia, out);
    }

    /** League Rating 单场 XLSX 写入（战队名称覆盖仅本次调用内使用）。 */
    void writeSingleLeagueExcel(final Battle battle,
                                final LeagueRatingResult result,
                                final Map<String, String> teamNames,
                                final OutputStream out) throws IOException {
        ExcelExporter.writeSingleLeague(battle, result, tankopedia, teamNames, out);
    }

    /** 与 preview/export 完全相同的 authoritative full processing 链（禁止 raw parse 回归）。 */
    private Battle processFull(final Source source) {
        final ReplayProcessingResult result = processingFacade.process(source, ReplayProcessingOptions.full());
        if (result.battle() != null) {
            return result.battle();
        }
        final String message = result.error() != null && StringUtils.hasText(result.error().message())
                ? result.error().message() : "REPLAY_PROCESSING_FAILED";
        throw new IllegalArgumentException(message);
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
        return "EXPORT_JOB_FAILED";
    }

    private void recordQueueWait(final long submittedNanos, final long startNanos, final String mode) {
        if (meterRegistry != null) {
            timer("wotb_replay_export_job_queue_wait_seconds", mode).record(startNanos - submittedNanos, TimeUnit.NANOSECONDS);
        }
    }

    private void recordTerminal(final ExportJob.Snapshot snap, final long durationNanos, final String mode) {
        if (meterRegistry == null) {
            return;
        }
        meterRegistry.counter("wotb_replay_export_job_result_total",
                        "result", snap.status().name().toLowerCase(java.util.Locale.ROOT))
                .increment();
        timer("wotb_replay_export_job_duration_seconds", mode).record(durationNanos, TimeUnit.NANOSECONDS);
    }

    private Timer timer(final String name, final String mode) {
        return Timer.builder(name)
                .tag("mode", mode)
                .register(meterRegistry);
    }

    /** 删除 job artifact（partial zip / 未完成 xlsx 不得变成可下载 READY 产物）。 */
    private static void deleteArtifact(final ExportJob job) {
        final Path artifact = job.artifactPath();
        if (artifact != null) {
            try {
                Files.deleteIfExists(artifact);
            } catch (final IOException e) {
                LOGGER.warn("export_job_artifact_delete_failed jobId={} path={} error={}",
                        job.jobId(), artifact, e.getMessage());
            }
        }
    }

    private static String logLine(final String event, final String jobId, final Object... kv) {
        final StringBuilder sb = new StringBuilder("event=").append(event).append(" jobId=").append(jobId);
        for (int i = 0; i + 1 < kv.length; i += 2) {
            sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        }
        return sb.toString();
    }

    private static String uniqueName(final String preferred, final Set<String> usedNames) {
        final String safe = preferred.replace('\\', '_').replace('/', '_');
        if (usedNames.add(safe)) {
            return safe;
        }
        final int dot = safe.lastIndexOf('.');
        final String base = dot > 0 ? safe.substring(0, dot) : safe;
        final String ext = dot > 0 ? safe.substring(dot) : "";
        for (int i = 2; ; i++) {
            final String candidate = base + "-" + i + ext;
            if (usedNames.add(candidate)) {
                return candidate;
            }
        }
    }

    /** 协作取消 checkpoint 信号（进度回调/循环内抛出，runJob 统一转 CANCELLED）。 */
    private static final class JobCancelledException extends RuntimeException {
    }

    /** 0 场有效回放：不生成空 Excel，终态 FAILED + NO_VALID_REPLAYS。 */
    private static final class NoValidReplaysException extends RuntimeException {
    }
}
