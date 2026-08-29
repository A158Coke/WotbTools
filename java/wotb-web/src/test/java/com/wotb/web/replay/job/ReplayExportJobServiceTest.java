package com.wotb.web.replay.job;

import com.wotb.core.league.LeagueFailure;
import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.league.LeagueRatingBatchAggregator;
import com.wotb.core.league.LeagueRatingCalculator;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/** Export Job 编排回归：lifecycle / progress / artifact / 失败 / 取消。 */
class ReplayExportJobServiceTest {

    private Path tmpDir;
    private ExportJobStore store;
    private ReplayExportJobService service;
    private DefaultReplayProcessingFacade facade;
    private ReplayExportWorkerExecutor executor;
    private SimpleMeterRegistry meterRegistry;

    @BeforeEach
    void setUp() throws Exception {
        tmpDir = Files.createTempDirectory("wotb-export-job-test");
        store = new ExportJobStore(tmpDir.toString(), 60);
        facade = mock(DefaultReplayProcessingFacade.class);
        executor = new ReplayExportWorkerExecutor(2, 4);
        meterRegistry = new SimpleMeterRegistry();
        service = new ReplayExportJobService(store, executor, null, meterRegistry);
    }

    @AfterEach
    void tearDown() {
        executor.close();
        deleteDir(tmpDir);
    }


    @Test
    void unknownJobIsNotFound() {
        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.status("nope"));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
    }

    // ---- Export 复用 Processing Job result（不重新上传 / 不 processFull）----

    @Test
    void createFromProcessingResultAggregateReusesDatasetWithoutReprocessing() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-processing-reuse-test"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);

            // 构造一个已 READY 的 Processing Job（含已解析 dataset）
            final String pJobId = "proc-1";
            final ReplayProcessingJob pJob = new ReplayProcessingJob(pJobId, 3);
            pJob.startProcessing();
            pJob.updateProgress(3, 1, 1);
            pJob.markReady(new ProcessedDataset(
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(new String[]{"dup.wotbreplay", "arena-1"}),
                    List.<String[]>of(new String[]{"bad.wotbreplay", "REPLAY_PROCESSING_FAILED"}),
                    null, null));
            processingStore.register(pJob);
            // Export acquire 引用（引用计数阻止 TTL 清理）
            processingStore.acquireForExport(pJobId);

            final String jobId = service.createJob(null, "aggregate", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            assertEquals(3, snap.total(), "total 与 Processing 输入总数一致");
            assertEquals(3, snap.processed(), "复用路径 processed 必须 == total");
            assertEquals(1, snap.duplicates());
            assertEquals(1, snap.failures());

            // 关键验收：facade.processFull 必须零次调用（Export 不再 processFull）
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));

            // artifact 可打开、filename 正确
            final Path artifact = store.get(jobId).artifactPath();
            assertTrue(Files.exists(artifact));
            assertEquals("one.xlsx", snap.filename(), "1 场有效时按单场命名（与上传路径一致）");
            try (Workbook wb = new XSSFWorkbook(Files.newInputStream(artifact))) {
                assertEquals("玩家数据", wb.getSheetName(0));
            }
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir(""));
            // jobDir("") 不是临时目录本身；直接删临时目录
            deleteDir(processingStore.jobDir("proc-1").getParent());
        }
    }

    @Test
    void createFromProcessingResultEachProducesZipWithoutReprocessing() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-processing-reuse-each"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = "proc-2";
            final ReplayProcessingJob pJob = new ReplayProcessingJob(pJobId, 2);
            pJob.startProcessing();
            pJob.updateProgress(2, 0, 0);
            pJob.markReady(new ProcessedDataset(
                    List.of(battle("arena-1"), battle("arena-2")),
                    List.of("one.wotbreplay", "two.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of(), null, null));
            processingStore.register(pJob);
            processingStore.acquireForExport(pJobId);

            final String jobId = service.createJob(null, "each", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            assertEquals("application/zip", snap.contentType());
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            assertEquals(List.of("one.xlsx", "two.xlsx"), zipEntryNames(jobId));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-2").getParent());
        }
    }

    @Test
    void createFromUnknownProcessingJobIsNotFound() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-processing-missing"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final ResponseStatusException error = assertThrows(ResponseStatusException.class,
                    () -> service.createJob(null, "aggregate", "no-such-job"));
            assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode(), "引用不存在的 Processing Job 必须 404");
        } finally {
            deleteDir(processingStore.jobDir("x").getParent());
        }
    }

    @Test
    void createFromNotReadyProcessingJobIsConflict() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-processing-notready"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final ReplayProcessingJob pJob = new ReplayProcessingJob("proc-3", 1);
            pJob.startProcessing();  // PROCESSING，未 READY
            processingStore.register(pJob);
            final ResponseStatusException error = assertThrows(ResponseStatusException.class,
                    () -> service.createJob(null, "aggregate", "proc-3"));
            assertEquals(HttpStatus.CONFLICT, error.getStatusCode(), "引用未 READY 的 Processing Job 必须 409");
        } finally {
            deleteDir(processingStore.jobDir("proc-3").getParent());
        }
    }

    // ---- from-result each 的 valid 语义（processed 与 failures 不得相减）----

    @Test
    void fromResultEachWithOneValidOneFailureProducesZip() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-1v1f"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJob(processingStore, "proc-1v1f",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(),
                    List.<String[]>of(new String[]{"bad.wotbreplay", "REPLAY_PROCESSING_FAILED"}));

            final String jobId = service.createJob(null, "each", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status(),
                    "1 valid + 1 failure 必须 READY（validCount > 0 即允许生成 ZIP）");
            assertEquals(2, snap.processed(), "processed 最终 = valid + failures = 2（不得减 failures）");
            assertEquals(1, snap.failures(), "failures 只用于终态统计，不影响 valid 判断");
            assertEquals(List.of("one.xlsx"), zipEntryNames(jobId), "ZIP 只含 1 个有效场 entry");
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-1v1f").getParent());
        }
    }

    @Test
    void fromResultEachWithOneValidTwoFailuresProducesZip() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-1v2f"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJob(processingStore, "proc-1v2f",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(),
                    List.<String[]>of(new String[]{"b1.wotbreplay", "REPLAY_PROCESSING_FAILED"},
                            new String[]{"b2.wotbreplay", "REPLAY_PROCESSING_FAILED"}));

            final String jobId = service.createJob(null, "each", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            assertEquals(3, snap.processed());
            assertEquals(2, snap.failures());
            assertEquals(List.of("one.xlsx"), zipEntryNames(jobId));
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-1v2f").getParent());
        }
    }

    @Test
    void fromResultEachWithTwoValidFiveFailuresProducesZip() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-2v5f"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJob(processingStore, "proc-2v5f",
                    List.of(battle("arena-1"), battle("arena-2")),
                    List.of("one.wotbreplay", "two.wotbreplay"),
                    List.<String[]>of(),
                    List.<String[]>of(new String[]{"f1.wotbreplay", "E1"}, new String[]{"f2.wotbreplay", "E2"},
                            new String[]{"f3.wotbreplay", "E3"}, new String[]{"f4.wotbreplay", "E4"},
                            new String[]{"f5.wotbreplay", "E5"}));

            final String jobId = service.createJob(null, "each", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            assertEquals(7, snap.processed(), "processed 最终 = 2 valid + 5 failures = 7");
            assertEquals(5, snap.failures());
            assertEquals(List.of("one.xlsx", "two.xlsx"), zipEntryNames(jobId), "ZIP 含全部有效场");
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-2v5f").getParent());
        }
    }

    @Test
    void fromResultEachWithZeroValidFailsNoValidReplays() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-0v"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJob(processingStore, "proc-0v",
                    List.of(), List.of(),
                    List.<String[]>of(),
                    List.<String[]>of(new String[]{"bad.wotbreplay", "REPLAY_PROCESSING_FAILED"}));

            final String jobId = service.createJob(null, "each", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.FAILED, snap.status(), "validCount == 0 必须 NO_VALID_REPLAYS");
            assertEquals("NO_VALID_REPLAYS", snap.errorCode());
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-0v").getParent());
        }
    }

    @Test
    void fromResultAggregateWithZeroValidFailsNoValidReplays() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-0v-agg"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJob(processingStore, "proc-0v-agg",
                    List.of(), List.of(),
                    List.<String[]>of(),
                    List.<String[]>of(new String[]{"bad.wotbreplay", "REPLAY_PROCESSING_FAILED"}));

            final String jobId = service.createJob(null, "aggregate", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.FAILED, snap.status());
            assertEquals("NO_VALID_REPLAYS", snap.errorCode());
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-0v-agg").getParent());
        }
    }

    // ---- from-result Export 只读消费 ProcessedDataset（不再 mutate 共享 Battle facts）----

    @Test
    void fromResultExportsDoNotMutateProcessedDataset() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b3-nomutate"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            // 未 enrich 的 dataset（模拟创建时 invariant 被满足前的原始 battle）
            final Battle b = battle("arena-1");
            b.players.getFirst().damageDealt = 5000;
            b.players.getFirst().kills = 2;
            final String pJobId = readyProcessingJob(processingStore, "proc-nomutate",
                    List.of(b), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            // aggregate 复用导出 → READY
            final String aggJob = service.createJob(null, "aggregate", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(aggJob, 10_000).status());
            // each 复用导出 → READY
            final String eachJob = service.createJob(null, "each", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(eachJob, 10_000).status());

            // 关键：共享 Battle 未被 populateBattle 修改（from-result 只读消费，
            // 不得二次回填 Performance Metrics；Potential Damage 已全局移除）
            assertEquals(null, b.players.getFirst().contribution,
                    "populateBattle 不得在 from-result 路径再次执行（HP 已知场会回填 contribution）");
            assertEquals(null, b.players.getFirst().kast);
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-nomutate").getParent());
        }
    }

    @Test
    void fromResultExportPreservesPreEnrichedMetrics() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b3-parity"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            // 模拟 Processing Job 创建 dataset 前的 enrich invariant（facts 层 enrich 只由数据集创建方保证）
            final Battle b = battle("arena-1");
            b.players.getFirst().damageDealt = 5000;
            final List<Battle> battles = List.of(b);
            for (final Battle battle : battles) {
                PerformanceMetricsCalculator.populateBattle(battle);
            }
            assertEquals(5000, b.players.getFirst().damageDealt, "测试前置：damageDealt 应保持 5000");
            assertNotNull(b.players.getFirst().contribution, "测试前置：HP 已知场 populateBattle 应回填 contribution");
            final String pJobId = readyProcessingJob(processingStore, "proc-parity",
                    battles, List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            final String aggJob = service.createJob(null, "aggregate", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(aggJob, 10_000).status());
            assertEquals(5000, b.players.getFirst().damageDealt,
                    "from-result 导出不得改动已 enrich 的权威 metrics（Preview/Export parity）");
            assertNotNull(b.players.getFirst().contribution);
            final String eachJob = service.createJob(null, "each", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(eachJob, 10_000).status());
            assertEquals(5000, b.players.getFirst().damageDealt);
            assertNotNull(b.players.getFirst().contribution);
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-parity").getParent());
        }
    }

    // ---- acquire Processing result 后的 refcount ownership lifecycle ----

    @Test
    void storageFailureAfterAcquireReleasesProcessingRefcount() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-storagefail"), 60);
        // 最小 test seam：inputDir 指向一个已存在文件 → Files.createDirectories 抛 IOException
        final Path blockerFile = Files.createTempFile(tmpDir, "blocker-", ".tmp");
        final ExportJobStore failingStore = new ExportJobStore(tmpDir, 60) {
            @Override
            public Path inputDir(final String jobId) {
                return blockerFile;
            }
        };
        try {
            service = new ReplayExportJobService(failingStore, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJobNoAcquire(processingStore, "proc-storagefail",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            // acquire 成功（refcount +1）→ Export job 目录创建失败 → 必须 throw
            final IllegalStateException error = assertThrows(IllegalStateException.class,
                    () -> service.createJob(null, "aggregate", pJobId));
            assertEquals("EXPORT_JOB_STORAGE_UNAVAILABLE", error.getMessage());

            // refcount 已释放：aged + TTL sweep 后 Processing Job 可被清理（不永久 pin 在 heap）
            ageProcessingJob(processingStore.get(pJobId));
            processingStore.sweepExpired();
            assertNull(processingStore.get(pJobId),
                    "storage failure 后 acquire 的引用必须 release，TTL 不得被泄漏 refcount 永久阻止");
        } finally {
            deleteDir(processingStore.jobDir("proc-storagefail").getParent());
        }
    }

    @Test
    void successfulFromResultExportReleasesProcessingRefcountForTtlCleanup() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-success"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJobNoAcquire(processingStore, "proc-success",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            final String jobId = service.createJob(null, "aggregate", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(jobId, 10_000).status());

            // worker 终态 finally release → TTL 可清理
            ageProcessingJob(processingStore.get(pJobId));
            processingStore.sweepExpired();
            assertNull(processingStore.get(pJobId), "worker 终态后引用必须 release，TTL 可清理");
        } finally {
            deleteDir(processingStore.jobDir("proc-success").getParent());
        }
    }

    @Test
    void queuedCancelFromResultReleasesProcessingRefcountForTtlCleanup() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-queuedcancel"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJobNoAcquire(processingStore, "proc-queuedcancel",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            // 直接占用唯一 worker（from-result 任务无解析阻塞点；用 executor 原生任务占位）
            final CountDownLatch started = new CountDownLatch(1);
            final CountDownLatch releaseA = new CountDownLatch(1);
            executor.submit("blocker", () -> {
                started.countDown();
                try {
                    releaseA.await(10, TimeUnit.SECONDS);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            assertTrue(started.await(5, TimeUnit.SECONDS), "blocker 应占用唯一 worker");

            // jobB：from-result → QUEUED（acquire +1，等 worker）
            final String jobB = service.createJob(null, "aggregate", pJobId);
            // QUEUED 取消 → removeQueued → 请求线程 release（引用计数语义保留）
            assertTrue(service.cancel(jobB));
            assertEquals(ExportJob.Status.CANCELLED, service.status(jobB).status());

            ageProcessingJob(processingStore.get(pJobId));
            processingStore.sweepExpired();
            assertNull(processingStore.get(pJobId), "QUEUED 取消后引用必须 release，TTL 可清理");

            releaseA.countDown();
        } finally {
            deleteDir(processingStore.jobDir("proc-queuedcancel").getParent());
        }
    }

    @Test
    void submitRejectedFromResultReleasesProcessingRefcountForTtlCleanup() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-submitreject"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyProcessingJobNoAcquire(processingStore, "proc-submitreject",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            // blocker 占住唯一 worker，filler 占满 queue → 第三个 submit 必须被拒绝
            final CountDownLatch started = new CountDownLatch(1);
            final CountDownLatch releaseA = new CountDownLatch(1);
            executor.submit("blocker", () -> {
                started.countDown();
                try {
                    releaseA.await(10, TimeUnit.SECONDS);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            assertTrue(started.await(5, TimeUnit.SECONDS), "blocker 应占用唯一 worker");
            executor.submit("filler", () -> {
                try {
                    releaseA.await(10, TimeUnit.SECONDS);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });

            // jobC：from-result → acquire +1 → submit rejection → finally 必须 release
            assertThrows(ExportQueueFullException.class,
                    () -> service.createJob(null, "aggregate", pJobId));

            ageProcessingJob(processingStore.get(pJobId));
            processingStore.sweepExpired();
            assertNull(processingStore.get(pJobId), "submit rejection 后引用必须 release，TTL 可清理");

            releaseA.countDown();
        } finally {
            deleteDir(processingStore.jobDir("proc-submitreject").getParent());
        }
    }

    // ---- BLOCKER 2：Export 不再接受裸 replay 上传（legacy multipart 已废弃）----

    @Test
    void exportJobWithoutProcessingJobIdIsRejectedAsGone() {
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service.createJob(
                        new MockMultipartFile[]{new MockMultipartFile(
                                "files", "a.wotbreplay", "application/octet-stream", new byte[]{1})},
                        "aggregate", null, (String) null));
        assertEquals(HttpStatus.GONE, e.getStatusCode());
        assertEquals(com.wotb.web.replay.ReplayLegacyEndpoints.DEPRECATED_ERROR, e.getReason());
    }

    /** 构造并注册一个已 READY 的 Processing Job（不 acquire——让 createJob 成为唯一引用来源，便于断言 refcount balance）。 */
    private String readyProcessingJobNoAcquire(final ReplayProcessingJobStore processingStore, final String id,
                                              final List<Battle> battles, final List<String> names,
                                              final List<String[]> duplicates, final List<String[]> failures) {
        final int total = battles.size() + duplicates.size() + failures.size();
        final ReplayProcessingJob pJob = new ReplayProcessingJob(id, total);
        pJob.startProcessing();
        pJob.updateProgress(total, duplicates.size(), failures.size());
        pJob.markReady(new ProcessedDataset(battles, names, duplicates, failures, null, null));
        processingStore.register(pJob);
        return id;
    }

    /** 把 Processing Job 的 finishedAt 拨旧，模拟 TTL 过期（反射，与 ReplayProcessingJobServiceTest.ageJob 相同）。 */
    private static void ageProcessingJob(final ReplayProcessingJob job) throws Exception {
        final java.lang.reflect.Field stateField = ReplayProcessingJob.class.getDeclaredField("state");
        stateField.setAccessible(true);
        final Object state = stateField.get(job);
        final java.lang.reflect.Field finishedField = state.getClass().getDeclaredField("finishedAtMillis");
        finishedField.setAccessible(true);
        finishedField.setLong(state, System.currentTimeMillis() - 61 * 60 * 1000L);
    }
    /** 构造并注册一个已 READY 的 Processing Job（from-result 复用路径测试用；调用方负责 release）。 */
    private String readyProcessingJob(final ReplayProcessingJobStore processingStore, final String id,
                                      final List<Battle> battles, final List<String> names,
                                      final List<String[]> duplicates, final List<String[]> failures) {
        final int total = battles.size() + duplicates.size() + failures.size();
        final ReplayProcessingJob pJob = new ReplayProcessingJob(id, total);
        pJob.startProcessing();
        pJob.updateProgress(total, duplicates.size(), failures.size());
        pJob.markReady(new ProcessedDataset(battles, names, duplicates, failures, null, null));
        processingStore.register(pJob);
        processingStore.acquireForExport(id);
        return id;
    }
    private static Battle battle(final String arenaId) {
        final Battle b = new Battle();
        b.arenaId = arenaId;
        b.winnerTeam = 1;
        b.players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = i + 1L;
            p.nickname = "p" + (i + 1);
            p.team = i < 7 ? 1 : 2;
            p.tankId = 4481L;
            b.players.add(p);
        }
        return b;
    }


    // ---- League Rating 战队名称覆盖（单场 battle / 批次 teamKey 分离） ----

    @Test
    void leagueExportFromResultAppliesBattleTeamNameOverrideWithoutReprocessing() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-reuse"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyLeagueProcessingJob(processingStore, "proc-l1", "arena-1");

            // 复用 processingJobId + 单场 battle override（名称必须进入 Excel）
            final String jobId = service.createJob(null, "aggregate", pJobId,
                    "{\"battle\":{\"arena-1:1\":\"CHRD Test\"}}");
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            // Test 2：复用路径不重新 process replay
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            try (Workbook wb = new XSSFWorkbook(Files.newInputStream(store.get(jobId).artifactPath()))) {
                final String text = workbookText(wb);
                assertTrue(text.contains("CHRD Test"),
                        "用户编辑的单场队名必须进入 Excel，实际：" + text);
            }
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }

    @Test
    void leagueAggregateExportAppliesTeamKeyOverride() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-agg"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            // 两场 team1 均 clan=AAA → 批次 teamKey = clan:AAA（跨场聚合为一行）
            final String pJobId = readyLeagueProcessingJob(processingStore, "proc-l2", "arena-1", "arena-2");

            // Test 5：批次 teamKey override 进入 aggregate Excel 战队汇总
            final String jobId = service.createJob(null, "aggregate", pJobId,
                    "{\"summary\":{\"clan:AAA\":\"CHRD A队\"}}");
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            try (Workbook wb = new XSSFWorkbook(Files.newInputStream(store.get(jobId).artifactPath()))) {
                final Sheet sheet = wb.getSheet("战队汇总");
                assertNotNull(sheet, "aggregate League 必须含战队汇总表");
                assertTrue(sheetText(sheet).contains("CHRD A队"),
                        "批次 teamKey override 必须进入战队汇总，实际：" + sheetText(sheet));
            }
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }

    @Test
    void leagueAggregateExportFromResultPartialRatedReady() throws Exception {
        // 生产 500 回归补测（mode=aggregate + processingJobId reuse + partial-rated dataset）：
        // battles=2（1 rated + 1 Rating-ineligible）→ Export READY、errorCode null、XLSX 合法；
        // League 汇总只统计 rated 样本；战斗列表同时含 rated + ineligible（失败原因）。
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-agg-partial"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String ratedArena = "arena-r";
            final String ineligibleArena = "arena-i";
            final Battle rated = leagueBattle(ratedArena);
            final Battle ineligible = leagueBattle(ineligibleArena);
            ineligible.players.remove(0); // 13 人 → Rating-ineligible（resultFor=null）
            final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                    List.of(rated), List.of(LeagueRatingCalculator.calculate(rated)),
                    List.of(new LeagueFailure(ineligibleArena + ".wotbreplay", ineligibleArena,
                            LeagueFailure.Code.NOT_SEVEN_VS_SEVEN)));
            final ProcessedDataset ds = new ProcessedDataset(
                    List.of(rated, ineligible),
                    List.of(ratedArena + ".wotbreplay", ineligibleArena + ".wotbreplay"),
                    List.of(), List.of(), batch, null);
            final ReplayProcessingJob pJob = new ReplayProcessingJob("proc-partial", ds.validCount());
            pJob.startProcessing();
            pJob.updateProgress(ds.validCount(), 0, 0);
            pJob.markReady(ds);
            processingStore.register(pJob);
            processingStore.acquireForExport("proc-partial");

            final String jobId = service.createJob(null, "aggregate", "proc-partial");
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status(),
                    "partial-rated League aggregate 必须 READY（不得 INTERNAL_ERROR / NPE / IOOBE）");
            assertNull(snap.errorCode());
            try (Workbook wb = new XSSFWorkbook(Files.newInputStream(store.get(jobId).artifactPath()))) {
                final String text = workbookText(wb);
                assertTrue(text.contains("arena-r"), "战斗列表必须含 rated 场");
                assertTrue(text.contains("arena-i"), "战斗列表必须含 Rating-ineligible 场");
                assertTrue(text.contains("已评分"), "rated 场战斗列表状态必须为已评分");
                assertTrue(text.contains("非标准 7v7"), "ineligible 场战斗列表必须显示失败原因");
            }
            processingStore.release("proc-partial");
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }

    @Test
    void leagueAggregateExportFromResultWithUnknownDeathTimeReady() throws Exception {
        // PR #135 契约：UNKNOWN death-time 场照常评分；ratingQuality / canonical 收口
        // 不得破坏 Export path（processingJobId reuse + aggregate → READY + XLSX 合法）。
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-agg-unknown"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final Battle unknown = leagueBattle("arena-1");
            unknown.players.get(0).survived = false;
            unknown.players.get(0).survivalTimeSec = 0; // 死亡时间 UNKNOWN
            final Battle normal = leagueBattle("arena-2");
            final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                    List.of(unknown, normal),
                    List.of(LeagueRatingCalculator.calculate(unknown),
                            LeagueRatingCalculator.calculate(normal)),
                    List.of());
            assertEquals(1, batch.ratingQuality().unknownDeathTimePlayers(),
                    "canonical 后 UNKNOWN 玩家计入 quality（aggregate 路径一致性）");
            final ProcessedDataset ds = new ProcessedDataset(
                    List.of(unknown, normal),
                    List.of("arena-1.wotbreplay", "arena-2.wotbreplay"),
                    List.of(), List.of(), batch, null);
            final ReplayProcessingJob pJob = new ReplayProcessingJob("proc-unknown", ds.validCount());
            pJob.startProcessing();
            pJob.updateProgress(ds.validCount(), 0, 0);
            pJob.markReady(ds);
            processingStore.register(pJob);
            processingStore.acquireForExport("proc-unknown");

            final String jobId = service.createJob(null, "aggregate", "proc-unknown");
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            assertNull(snap.errorCode());
            try (Workbook wb = new XSSFWorkbook(Files.newInputStream(store.get(jobId).artifactPath()))) {
                assertNotNull(wb.getSheet("选手汇总"), "UNKNOWN 场必须正常生成 League 汇总表");
                assertNotNull(wb.getSheet("每场明细"), "UNKNOWN 场必须正常生成每场明细表");
            }
            processingStore.release("proc-unknown");
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }

    @Test
    void leagueAggregateExportFromResultZeroRatedStillReady() throws Exception {
        // 产品契约：Replay 解析成功即使 0 场 eligible，dataset 仍有效；aggregate 必须成功导出
        // （基础 Replay sheets 存在、League summary 为空、战斗列表显示失败原因），不得因
        // battleResults.isEmpty() 500。
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-agg-zero"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final Battle i1 = leagueBattle("arena-a");
            i1.players.remove(0); // 13 人
            final Battle i2 = leagueBattle("arena-b");
            i2.players.remove(0);
            final List<LeagueFailure> failures = List.of(
                    new LeagueFailure("arena-a.wotbreplay", "arena-a", LeagueFailure.Code.NOT_SEVEN_VS_SEVEN),
                    new LeagueFailure("arena-b.wotbreplay", "arena-b", LeagueFailure.Code.NOT_SEVEN_VS_SEVEN));
            final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                    List.of(), List.of(), failures);
            final ProcessedDataset ds = new ProcessedDataset(
                    List.of(i1, i2),
                    List.of("arena-a.wotbreplay", "arena-b.wotbreplay"),
                    List.of(), List.of(), batch, null);
            final ReplayProcessingJob pJob = new ReplayProcessingJob("proc-zero", ds.validCount());
            pJob.startProcessing();
            pJob.updateProgress(ds.validCount(), 0, 0);
            pJob.markReady(ds);
            processingStore.register(pJob);
            processingStore.acquireForExport("proc-zero");

            final String jobId = service.createJob(null, "aggregate", "proc-zero");
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status(),
                    "0 场可评分的 League dataset 仍应成功导出");
            assertNull(snap.errorCode());
            try (Workbook wb = new XSSFWorkbook(Files.newInputStream(store.get(jobId).artifactPath()))) {
                final String text = workbookText(wb);
                assertTrue(text.contains("非标准 7v7"), "战斗列表必须显示 Rating-ineligible 失败原因");
            }
            processingStore.release("proc-zero");
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }

    @Test
    void leagueEachExportAppliesPerBattleTeamNames() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-each"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            final String pJobId = readyLeagueProcessingJob(processingStore, "proc-l3", "arena-1", "arena-2");

            // Test 6：each ZIP 中每场使用各自 battle override，不得串队名
            final String jobId = service.createJob(null, "each", pJobId,
                    "{\"battle\":{\"arena-1:1\":\"CHRD A\",\"arena-2:1\":\"CHRD B\"}}");
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            final List<String> entryNames = new ArrayList<>();
            final List<String> texts = new ArrayList<>();
            try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(store.get(jobId).artifactPath()))) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    final byte[] entryBytes = zip.readAllBytes();
                    try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(entryBytes))) {
                        texts.add(workbookText(wb));
                    }
                    entryNames.add(entry.getName());
                }
            }
            assertEquals(List.of("arena-1.xlsx", "arena-2.xlsx"), entryNames);
            assertEquals(2, texts.size());
            assertTrue(texts.get(0).contains("CHRD A"), "arena-1 单场应显示 CHRD A");
            assertTrue(texts.get(1).contains("CHRD B"), "arena-2 单场应显示 CHRD B");
            assertFalse(texts.get(0).contains("CHRD B"), "不得串队名");
            assertFalse(texts.get(1).contains("CHRD A"), "不得串队名");
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }


    @Test
    void leagueEachReuseKeepsRatingIneligibleBattleAndDoesNotReprocess() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-league-reuse-each"), 60);
        try {
            service = new ReplayExportJobService(store, executor,
                    processingStore, meterRegistry);
            // 1 场 rated + 1 场 Rating-ineligible（batch.resultFor=null）
            final String pJobId = readyLeagueProcessingJobWithIneligible(
                    processingStore, "proc-re1", "arena-1", "arena-2");
            final String jobId = service.createJob(null, "each", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            // ZIP 必须含 2 个 XLSX（1 League + 1 Standard）
            assertEquals(List.of("arena-1.xlsx", "arena-2.xlsx"), zipEntryNames(jobId));
            final List<String> texts = new ArrayList<>();
            try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(store.get(jobId).artifactPath()))) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) {
                        texts.add(workbookText(wb));
                    }
                }
            }
            assertEquals(2, texts.size());
            assertTrue(texts.get(0).contains("战队Rating"), "rated 场应为 League 单场工作簿");
            assertFalse(texts.get(1).contains("战队Rating"), "ineligible 场应为标准单场工作簿（无 Rating 块）");
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("").getParent());
        }
    }

    @Test
    void parseTeamNamesToleratesMalformedAndSplitsScopes() {
        // Test 7：非法/缺失 → 空（null safe，不 500）
        assertEquals(TeamNameOverrides.empty(), ReplayExportJobService.parseTeamNames(null));
        assertEquals(TeamNameOverrides.empty(), ReplayExportJobService.parseTeamNames(""));
        assertEquals(TeamNameOverrides.empty(), ReplayExportJobService.parseTeamNames("not-json{"));
        assertEquals(TeamNameOverrides.empty(), ReplayExportJobService.parseTeamNames("42"));
        // 结构化：battle + summary 分离（两种 identity 隔离）
        final TeamNameOverrides structured = ReplayExportJobService.parseTeamNames(
                "{\"battle\":{\"a:1\":\"X\"},\"summary\":{\"clan:CHRD\":\"Y\"}}");
        assertEquals("X", structured.battle().get("a:1"));
        assertEquals("Y", structured.summary().get("clan:CHRD"));
        // 扁平 {arenaId:team: name} 向后兼容 → battle
        final TeamNameOverrides flat = ReplayExportJobService.parseTeamNames("{\"a:1\":\"X\"}");
        assertEquals("X", flat.battle().get("a:1"));
        assertTrue(flat.summary().isEmpty());
        // 只传 summary 也可
        final TeamNameOverrides onlySummary = ReplayExportJobService.parseTeamNames(
                "{\"summary\":{\"clan:CHRD\":\"Z\"}}");
        assertTrue(onlySummary.battle().isEmpty());
        assertEquals("Z", onlySummary.summary().get("clan:CHRD"));
    }

    /** League 7v7 数据集（team1 clan=AAA、team2 clan=BBB；已评分并聚合）。 */
    private static ProcessedDataset leagueDataset(final String... arenaIds) {
        final List<Battle> battles = new ArrayList<>();
        final List<String> names = new ArrayList<>();
        for (final String aid : arenaIds) {
            battles.add(leagueBattle(aid));
            names.add(aid + ".wotbreplay");
        }
        final List<LeagueRatingResult> results = new ArrayList<>();
        for (final Battle b : battles) {
            results.add(LeagueRatingCalculator.calculate(b));
        }
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(battles, results, List.of());
        return new ProcessedDataset(battles, names, List.of(), List.of(), batch, null);
    }

    /** League 数据集：ratedArena 有 Rating 结果；ineligibleArena 解析成功但无 Rating（13 人）。 */
    private static ProcessedDataset leagueDatasetWithIneligible(final String ratedArena, final String ineligibleArena) {
        final Battle rated = leagueBattle(ratedArena);
        final Battle ineligible = leagueBattle(ineligibleArena);
        ineligible.players.remove(0); // 13 人 → Rating-ineligible（battleResults 不含该场）
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(rated, ineligible), List.of(LeagueRatingCalculator.calculate(rated)), List.of());
        return new ProcessedDataset(List.of(rated, ineligible),
                List.of(ratedArena + ".wotbreplay", ineligibleArena + ".wotbreplay"),
                List.of(), List.of(), batch, null);
    }

    /** 单场合法 7v7 league battle（team1 clan=AAA、team2 clan=BBB；winner=1）。 */
    private static Battle leagueBattle(final String arenaId) {
        final Battle b = new Battle();
        b.arenaId = arenaId;
        b.arenaBonusType = 2;
        b.winnerTeam = 1;
        b.rosterComplete = true;
        b.durationS = 300.0;
        b.players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = i + 1L;
            p.nickname = "p" + (i + 1);
            p.team = i < 7 ? 1 : 2;
            p.tankId = 4481L;
            p.survived = true;
            p.survivalTimeSec = 300;
            p.damageDealt = 1000;
            p.damageAssisted = 100;
            p.damageReceived = 800;
            p.damageBlocked = 200;
            p.kills = 2;
            p.nShots = 10;
            p.nHitsDealt = 8;
            p.nPenetrationsDealt = 6;
            p.clan = i < 7 ? "AAA" : "BBB";
            b.players.add(p);
        }
        return b;
    }

    /** 构造并注册一个已 READY 的 League Processing Job（from-result 复用路径测试用；调用方负责 release）。 */
    private String readyLeagueProcessingJob(final ReplayProcessingJobStore processingStore, final String id,
                                            final String... arenaIds) throws Exception {
        final ProcessedDataset ds = leagueDataset(arenaIds);
        final ReplayProcessingJob pJob = new ReplayProcessingJob(id, ds.validCount());
        pJob.startProcessing();
        pJob.updateProgress(ds.validCount(), 0, 0);
        pJob.markReady(ds);
        processingStore.register(pJob);
        processingStore.acquireForExport(id);
        return id;
    }

    /** 已 READY 的 League Processing Job：1 场 rated + 1 场 Rating-ineligible（resultFor=null）。 */
    private String readyLeagueProcessingJobWithIneligible(final ReplayProcessingJobStore processingStore,
                                                          final String id, final String ratedArena,
                                                          final String ineligibleArena) throws Exception {
        final ProcessedDataset ds = leagueDatasetWithIneligible(ratedArena, ineligibleArena);
        final ReplayProcessingJob pJob = new ReplayProcessingJob(id, ds.validCount());
        pJob.startProcessing();
        pJob.updateProgress(ds.validCount(), 0, 0);
        pJob.markReady(ds);
        processingStore.register(pJob);
        processingStore.acquireForExport(id);
        return id;
    }

    /** 汇总整个 workbook 的字符串单元格（查找显示名用）。 */
    private static String workbookText(final Workbook wb) {
        final StringBuilder sb = new StringBuilder();
        for (int s = 0; s < wb.getNumberOfSheets(); s++) {
            sb.append(sheetText(wb.getSheetAt(s)));
        }
        return sb.toString();
    }

    private static String sheetText(final Sheet sheet) {
        final StringBuilder sb = new StringBuilder();
        for (int rr = 0; rr <= sheet.getLastRowNum(); rr++) {
            final var row = sheet.getRow(rr);
            if (row == null) {
                continue;
            }
            for (int c = 0; c < row.getLastCellNum(); c++) {
                final Cell cell = row.getCell(c);
                if (cell != null && cell.getCellType() == CellType.STRING) {
                    sb.append(cell.getStringCellValue());
                }
            }
        }
        return sb.toString();
    }

    // ---- helpers ----

    /** 按 ZIP 顺序收集 entry 名（验证 mode=each 输出顺序）。 */
    private List<String> zipEntryNames(final String jobId) throws Exception {
        final List<String> names = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(store.get(jobId).artifactPath()))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                names.add(entry.getName());
            }
        }
        return names;
    }

    private ExportJob.Snapshot awaitTerminal(final String jobId, final long timeoutMs) throws InterruptedException {
        final long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            final ExportJob job = store.get(jobId);
            if (job != null) {
                final ExportJob.Snapshot snap = job.snapshot();
                if (snap.status() == ExportJob.Status.READY
                        || snap.status() == ExportJob.Status.FAILED
                        || snap.status() == ExportJob.Status.CANCELLED) {
                    return snap;
                }
            }
            Thread.sleep(20);
        }
        throw new AssertionError("job did not reach terminal within " + timeoutMs + " ms: " + jobId);
    }

    private static void deleteDir(final Path dir) {
        try (var walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (final Exception ignored) {
                    // best-effort test cleanup
                }
            });
        } catch (final Exception ignored) {
            // best-effort test cleanup
        }
    }
}
