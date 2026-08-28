package com.wotb.web.replay.job;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.model.Battle;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.ReplayExportNames;
import com.wotb.web.replay.ReplayLegacyEndpoints;
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
 * <p>Create（request 线程）：复用 Replay Processing Job 的已解析
 * {@link ProcessedDataset}（BLOCKER 2：Export 不再接受裸 replay 上传——无
 * {@code processingJobId} 一律 410 {@code REPLAY_LEGACY_DEPRECATED}，绝不绕过
 * {@link ReplayParseScheduler} 创建第二套 full processing）→ 注册 job →
 * 提交有界 worker 池 → 202。Worker：直接生成 XLSX/ZIP 流式 artifact（不
 * ByteArrayOutputStream 全量驻留）→ READY。无 replay processing，故不获取全局
 * replay 容量许可。</p>
 */
@Service
public class ReplayExportJobService {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayExportJobService.class);

    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String ZIP_MIME = "application/zip";

    private final ExportJobStore store;
    private final ReplayExportWorkerExecutor workerExecutor;
    private final MeterRegistry meterRegistry;
    /** Processing Job result 提供方（Export 只消费已解析 result）。 */
    private final ReplayProcessingJobStore processingStore;
    private final Tankopedia tankopedia = Tankopedia.load();

    @Autowired
    public ReplayExportJobService(final ExportJobStore store,
                                  final ReplayExportWorkerExecutor workerExecutor,
                                  final ReplayProcessingJobStore processingStore,
                                  @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.store = store;
        this.workerExecutor = workerExecutor;
        this.processingStore = processingStore;
        this.meterRegistry = meterRegistry;
    }

    // ---- create / status / cancel / download ----

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
     * <p>V2 唯一路径（BLOCKER 2）：{@code processingJobId} <b>必填</b>——Export
     * 只复用 Replay Processing Job result，不重新上传 replay、不 processFull，
     * worker 直接从已解析的 {@link ProcessedDataset} 生成 XLSX/ZIP；Export 创建时对
     * Processing result acquire 引用（引用计数阻止其被 TTL 清理）。缺少
     * {@code processingJobId} 的裸 multipart 上传路径已废弃 → 410
     * {@code REPLAY_LEGACY_DEPRECATED}。</p>
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
        if (!StringUtils.hasText(processingJobId)) {
            // 传统「上传 replay → 导出」路径废弃：Export 只消费 Processing Job dataset，
            // 绝不在此创建 scheduler 之外的 full processing。
            throw ReplayLegacyEndpoints.gone();
        }
        final ReplayProcessingJob acquiredJob = processingStore.acquireForExport(processingJobId);
        if (acquiredJob == null) {
            final ReplayProcessingJob existing = processingStore.get(processingJobId);
            if (existing == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROCESSING_JOB_NOT_FOUND");
            }
            throw new ResponseStatusException(HttpStatus.CONFLICT, "PROCESSING_JOB_NOT_READY");
        }
        final ReplayProcessingJob processingJob = acquiredJob;
        final boolean acquired = true;
        final String jobId = UUID.randomUUID().toString();
        final ProcessedDataset ds = processingJob.result();
        // total = Processing 输入总数（valid + duplicates + failures），保持与解析时一致。
        final int total = ds.validCount() + ds.duplicates().size() + ds.failures().size();
        final Path inputDir = store.inputDir(jobId);
        // Processing result 引用所有权：acquire 成功后，任何在 worker 正式
        // 接手前的失败（job 目录创建 / register / submit rejection）都必须 release——否则 refcount
        // 永久泄漏，ReplayProcessingJobStore TTL sweeper 永远跳过该 dataset（heap 永久驻留）。
        // worker submit 成功即 ownershipTransferred=true，此后 release 由 worker 终态
        // （runJobFromResult finally）或 QUEUED remove 取消（cancel 请求线程）负责，exactly once。
        boolean ownershipTransferred = false;
        try {
            // 复用路径无上传输入，但 job 目录需要存在（artifact 写入目标）。
            try {
                Files.createDirectories(inputDir);
            } catch (final IOException e) {
                store.removeAndCleanup(jobId);
                throw new IllegalStateException("EXPORT_JOB_STORAGE_UNAVAILABLE");
            }
            final ExportJob job = new ExportJob(jobId, each ? "each" : "aggregate", total, processingJobId, teamNames);
            store.register(job);
            final long submittedNanos = System.nanoTime();
            try {
                workerExecutor.submit(jobId, () -> runJobFromResult(job, processingJob, each, submittedNanos));
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
                if (job.processingJobId() != null) {
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
            processingStore.release(processingJob.jobId());
        }
    }

    /**
     * aggregate：直接复用已 enrich 的 battles 生成汇总 XLSX（无任何 replay processing 步骤，
     * 只读消费 {@link ProcessedDataset}：不再次 populateBattle
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
