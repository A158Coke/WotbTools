package com.wotb.web.replay.job;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;
import com.wotb.core.parse.Replays;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.PotentialDamage;
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
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.AbstractList;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Replay Export Job 编排（docs/current-plan.md §7–§23）。
 *
 * <p>Create（request 线程）：校验 → 把上传输入持久化到 job 临时目录（绝不在异步
 * worker 持有 {@code MultipartFile}，§37）→ 注册 job → 提交有界 worker 池 → 202。
 * Worker（§23：batch 内 replay 仍串行）：全局容量许可（§21）→ 逐文件 full
 * processing（与 preview 同一 authoritative 链，§31）→ 真实进度 → XLSX/ZIP 写
 * 临时 artifact（不再 ByteArrayOutputStream 全量驻留，§15）→ READY。
 * metadata-only 不适用：本服务只处理导出，失败/取消按 §32/§33 语义。</p>
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
    private final Tankopedia tankopedia = Tankopedia.load();

    @Autowired
    public ReplayExportJobService(final ReplayCapacityLimiter capacityLimiter,
                                  final DefaultReplayProcessingFacade processingFacade,
                                  final ExportJobStore store,
                                  final ReplayExportWorkerExecutor workerExecutor,
                                  @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.capacityLimiter = capacityLimiter;
        this.processingFacade = processingFacade;
        this.store = store;
        this.workerExecutor = workerExecutor;
        this.meterRegistry = meterRegistry;
    }

    // ---- create / status / cancel / download ----

    /**
     * 创建 Export Job：校验并持久化输入后返回 jobId（202 语义）。
     * 队列满载抛 {@link ExportQueueFullException}（503 EXPORT_QUEUE_FULL）。
     */
    public String createJob(final MultipartFile[] files, final String mode) {
        ReplayUploadValidator.validate(files);
        if (files.length > ReplayService.MAX_REPLAY_FILES) {
            throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
        }
        final boolean each = "each".equalsIgnoreCase(mode);
        final String jobId = UUID.randomUUID().toString();
        final Path inputDir = store.inputDir(jobId);
        try {
            Files.createDirectories(inputDir);
            int i = 0;
            for (final MultipartFile f : files) {
                final String name = f.getOriginalFilename() == null ? "replay.wotbreplay" : f.getOriginalFilename();
                f.transferTo(inputDir.resolve(i + "__" + sanitizeFileName(name)));
                i++;
            }
        } catch (final IOException e) {
            store.removeAndCleanup(jobId);
            throw new IllegalStateException("EXPORT_JOB_STORAGE_UNAVAILABLE");
        }
        final ExportJob job = new ExportJob(jobId, each ? "each" : "aggregate", files.length);
        store.register(job);
        final long submittedNanos = System.nanoTime();
        try {
            workerExecutor.execute(() -> runJob(job, inputDir, each, submittedNanos));
        } catch (final RejectedExecutionException e) {
            store.removeAndCleanup(jobId);
            throw new ExportQueueFullException();
        }
        LOGGER.info(logLine("export_job_created", jobId, "files", files.length, "mode", job.mode()));
        return jobId;
    }

    public ExportJob.Snapshot status(final String jobId) {
        final ExportJob job = requireJob(jobId);
        return job.snapshot();
    }

    /** 取消：QUEUED 立即终态；PROCESSING 协作取消（worker checkpoint 后终态）。 */
    public boolean cancel(final String jobId) {
        final ExportJob job = requireJob(jobId);
        return job.requestCancel();
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
            // 全局 replay 容量仍然生效（§21）：job 化不绕过 max-concurrent-jobs=2。
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

    /** 终态收尾（exactly once 由 job 状态机保证）：日志 + 指标 + 无 artifact 即清理。 */
    private void finishTerminal(final ExportJob job, final long startNanos) {
        final ExportJob.Snapshot snap = job.snapshot();
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
        recordTerminal(snap, startNanos, snap.mode());
        // 终态（含 FAILED/CANCELLED）统一保留到 TTL，让前端能读到终态错误码；
        // 物理清理（输入 + artifact）由 ExportJobStore 的 TTL sweeper 完成（§18）。
    }

    private void processJob(final ExportJob job, final Path inputDir, final boolean each) throws Exception {
        final List<Path> inputs;
        try (var stream = Files.list(inputDir)) {
            inputs = stream.sorted().toList();
        }
        if (each) {
            processEach(job, inputs);
        } else {
            processAggregate(job, inputs);
        }
    }

    /** aggregate：Replays.collect 去重 + 逐文件进度（§11/§12/§13），串行（§23）。 */
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
            // 安全 checkpoint：每个 replay 完成后检查取消（§20）。
            if (job.isCancelled()) {
                throw new JobCancelledException();
            }
        };
        final Collected c = Replays.collect(lazySources(inputs), this::processFull, null, progress);
        if (job.isCancelled()) {
            throw new JobCancelledException();
        }
        if (c.battles.isEmpty()) {
            throw new NoValidReplaysException();
        }
        PotentialDamage.apply(c.battles, tankopedia);
        for (final Battle battle : c.battles) {
            PerformanceMetricsCalculator.populateBattle(battle);
        }
        job.advancePhase(ExportJob.Phase.BUILDING_EXCEL);
        final String filename = c.battles.size() == 1
                ? stripExt(c.battleSourceNames.getFirst()) + ".xlsx"
                : "联赛汇总.xlsx";
        final Path artifact = store.jobDir(job.jobId()).resolve("result.xlsx");
        try (OutputStream out = Files.newOutputStream(artifact)) {
            if (c.battles.size() == 1) {
                ExcelExporter.writeSingle(c.battles.getFirst(), tankopedia, out);
            } else {
                ExcelExporter.writeAggregate(c.battles, c.battleSourceNames, c.duplicates, tankopedia, out);
            }
        }
        job.markReady(filename, XLSX_MIME, artifact);
    }

    /** each：逐场独立 full processing + 流式写 ZIP（与既有同步 exportEach 语义一致，不去重）。 */
    private void processEach(final ExportJob job, final List<Path> inputs) throws Exception {
        int processed = 0;
        int failures = 0;
        final List<Battle> battles = new ArrayList<>();
        final List<String> names = new ArrayList<>();
        for (final Path p : inputs) {
            if (job.isCancelled()) {
                throw new JobCancelledException();
            }
            processed++;
            try {
                final Battle battle = processFull(new Source(inputName(p), Files.readAllBytes(p)));
                if (battle == null) {
                    throw new IllegalArgumentException("NO_BATTLE_DATA");
                }
                PotentialDamage.apply(List.of(battle), tankopedia);
                PerformanceMetricsCalculator.populateBattle(battle);
                battles.add(battle);
                names.add(inputName(p));
            } catch (final Exception e) {
                failures++;
            }
            job.updateProgress(processed, 0, failures);
            LOGGER.debug(logLine("export_job_progress", job.jobId(), "processed", processed,
                    "duplicates", 0, "failures", failures, "total", job.total()));
            if (job.isCancelled()) {
                throw new JobCancelledException();
            }
        }
        if (battles.isEmpty()) {
            throw new NoValidReplaysException();
        }
        job.advancePhase(ExportJob.Phase.BUILDING_ARCHIVE);
        final Path artifact = store.jobDir(job.jobId()).resolve("result.zip");
        final Set<String> usedNames = new HashSet<>();
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(artifact), StandardCharsets.UTF_8)) {
            for (int i = 0; i < battles.size(); i++) {
                final ZipEntry entry = new ZipEntry(uniqueName(stripExt(names.get(i)) + ".xlsx", usedNames));
                zip.putNextEntry(entry);
                // POI 直接写入 zip entry 流，避免每个 xlsx 的 byte[] 副本。
                ExcelExporter.writeSingle(battles.get(i), tankopedia, zip);
                zip.closeEntry();
            }
        }
        job.markReady("逐场导出.zip", ZIP_MIME, artifact);
    }

    /** 与 preview/export 完全相同的 authoritative full processing 链（§31，禁止 raw parse 回归）。 */
    private Battle processFull(final Source source) {
        final ReplayProcessingResult result = processingFacade.process(source, ReplayProcessingOptions.full());
        if (result.battle() != null) {
            return result.battle();
        }
        final String message = result.error() != null && StringUtils.hasText(result.error().message())
                ? result.error().message() : "REPLAY_PROCESSING_FAILED";
        throw new IllegalArgumentException(message);
    }

    /** 惰性 Source 列表：逐文件从磁盘读取（不在堆内一次性持有全部上传字节，§36）。 */
    private List<Source> lazySources(final List<Path> inputs) {
        return new AbstractList<>() {
            @Override
            public Source get(final int index) {
                final Path p = inputs.get(index);
                try {
                    return new Source(inputName(p), Files.readAllBytes(p));
                } catch (final IOException e) {
                    throw new UncheckedIOException(e);
                }
            }

            @Override
            public int size() {
                return inputs.size();
            }
        };
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

    private void recordTerminal(final ExportJob.Snapshot snap, final long startNanos, final String mode) {
        if (meterRegistry == null) {
            return;
        }
        meterRegistry.counter("wotb_replay_export_job_result_total",
                        "result", snap.status().name().toLowerCase(java.util.Locale.ROOT))
                .increment();
        timer("wotb_replay_export_job_duration_seconds", mode).record(System.nanoTime() - startNanos, TimeUnit.NANOSECONDS);
    }

    private Timer timer(final String name, final String mode) {
        return Timer.builder(name)
                .tag("mode", mode)
                .register(meterRegistry);
    }

    private static String logLine(final String event, final String jobId, final Object... kv) {
        final StringBuilder sb = new StringBuilder("event=").append(event).append(" jobId=").append(jobId);
        for (int i = 0; i + 1 < kv.length; i += 2) {
            sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        }
        return sb.toString();
    }

    /** 输入文件名安全化（防路径分隔符/异常字符）。 */
    static String sanitizeFileName(final String name) {
        final String safe = name.replace('\\', '_').replace('/', '_');
        return safe.isBlank() ? "replay.wotbreplay" : safe;
    }

    static String inputName(final Path p) {
        final String file = p.getFileName().toString();
        final int sep = file.indexOf("__");
        return sep >= 0 ? file.substring(sep + 2) : file;
    }

    private static String stripExt(final String name) {
        final int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
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

    /** 0 场有效回放（§33）：不生成空 Excel，终态 FAILED + NO_VALID_REPLAYS。 */
    private static final class NoValidReplaysException extends RuntimeException {
    }
}
