package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.PotentialDamage;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Timer;
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
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
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
import static org.mockito.Mockito.when;

/** Export Job 编排回归（plan §40–§43）：lifecycle / progress / artifact / 失败 / 取消。 */
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
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, meterRegistry);
    }

    @AfterEach
    void tearDown() {
        executor.close();
        deleteDir(tmpDir);
    }

    @Test
    void createJobRunsToReadyWithPlayableArtifact() throws Exception {
        stubFacadeBattles();
        final String jobId = service.createJob(new MultipartFile[]{file("battle-a.wotbreplay")}, "aggregate");

        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(1, snap.total());
        assertEquals(1, snap.processed());
        assertEquals(0, snap.duplicates());
        assertEquals(0, snap.failures());

        // artifact 存在、MIME/文件名正确、POI 可打开、sheet 顺序正确（§42）
        final Path artifact = store.get(jobId).artifactPath();
        assertTrue(Files.exists(artifact));
        assertEquals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", snap.contentType());
        assertEquals("battle-a.xlsx", snap.filename());
        try (Workbook wb = new XSSFWorkbook(Files.newInputStream(artifact))) {
            assertEquals("玩家数据", wb.getSheetName(0), "玩家数据必须是第一个 sheet");
            assertEquals("战斗信息", wb.getSheetName(1));
            assertEquals("原始字段", wb.getSheetName(2));
            assertEquals("玩家数据", wb.getSheetAt(wb.getActiveSheetIndex()).getSheetName());
        }
        assertEquals(ExportJob.Status.READY, service.status(jobId).status());
    }

    @Test
    void aggregateDeduplicatesAndCountsProgress() throws Exception {
        stubFacadeBattles();  // same arena for all names
        final String jobId = service.createJob(new MultipartFile[]{
                file("dup-a.wotbreplay"), file("dup-b.wotbreplay")}, "aggregate");

        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(2, snap.total());
        assertEquals(2, snap.processed(), "重复文件也推进 processed（§11）");
        assertEquals(1, snap.duplicates());
        assertEquals(0, snap.failures());
    }

    @Test
    void noValidReplaysFailsWithStableErrorCode() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full())))
                .thenThrow(new IllegalArgumentException("REPLAY_PROCESSING_FAILED"));
        final String jobId = service.createJob(new MultipartFile[]{file("bad.wotbreplay")}, "aggregate");

        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.FAILED, snap.status());
        assertEquals("NO_VALID_REPLAYS", snap.errorCode(), "0 场有效不得生成空 Excel（§33）");
        assertEquals(1, snap.failures());
    }

    @Test
    void cancelDuringProcessingIsCooperative() throws Exception {
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            release.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobId = service.createJob(new MultipartFile[]{file("block.wotbreplay")}, "aggregate");
        assertTrue(started.await(5, TimeUnit.SECONDS), "job 应开始处理");

        assertTrue(service.cancel(jobId), "PROCESSING 中取消应请求成功");
        release.countDown();

        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.CANCELLED, snap.status(), "协作取消后 worker 应终态 CANCELLED");
    }

    @Test
    void downloadBeforeReadyIsConflict() throws Exception {
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            release.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobId = service.createJob(new MultipartFile[]{file("block.wotbreplay")}, "aggregate");
        assertTrue(started.await(5, TimeUnit.SECONDS));

        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.download(jobId));
        assertEquals(HttpStatus.CONFLICT, error.getStatusCode());

        service.cancel(jobId);
        release.countDown();
        awaitTerminal(jobId, 10_000);
    }

    @Test
    void eachModeProducesZipWithOneXlsxPerBattle() throws Exception {
        stubFacadeBattlesDistinct();
        final String jobId = service.createJob(new MultipartFile[]{
                file("one.wotbreplay"), file("two.wotbreplay")}, "each");

        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals("application/zip", snap.contentType());
        final Path artifact = store.get(jobId).artifactPath();
        int entries = 0;
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(artifact))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                assertTrue(entry.getName().endsWith(".xlsx"));
                entries++;
            }
        }
        assertEquals(2, entries, "mode=each 每个有效回放一个 xlsx（§17）");
    }


    // ---- PR #118 Blocker A：QUEUED 取消必须真正释放 executor queue slot ----

    @Test
    void cancelledQueuedJobFreesQueueCapacity() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);

        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            releaseA.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")}, "aggregate");
        assertTrue(started.await(5, TimeUnit.SECONDS), "job A 应占用唯一 worker");

        final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")}, "aggregate");
        // workers=1 + queue=1 已满 → C 必须 503 EXPORT_QUEUE_FULL
        assertThrows(ExportQueueFullException.class,
                () -> service.createJob(new MultipartFile[]{file("c.wotbreplay")}, "aggregate"));

        // 取消 QUEUED 的 B → 必须立即释放 queue slot
        assertTrue(service.cancel(jobB));
        assertEquals(ExportJob.Status.CANCELLED, service.status(jobB).status());

        // 立即创建 C → 必须 ACCEPTED（不再 EXPORT_QUEUE_FULL）
        final String jobC = service.createJob(new MultipartFile[]{file("c.wotbreplay")}, "aggregate");
        assertNotNull(jobC, "取消 QUEUED job 后新 job 必须能立即入队");

        // 清理：取消 A（PROCESSING 协作取消）并释放，等待全部终态
        service.cancel(jobA);
        releaseA.countDown();
        awaitTerminal(jobA, 10_000);
        awaitTerminal(jobC, 10_000);
    }

    @Test
    void cancelledQueuedJobNeverProcessesReplay() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);

        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        final List<String> processedNames = new java.util.concurrent.CopyOnWriteArrayList<>();
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final com.wotb.core.model.Source s = inv.getArgument(0);
            processedNames.add(s.name());
            if (s.name().startsWith("a")) {
                started.countDown();
                releaseA.await(10, TimeUnit.SECONDS);
            }
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")}, "aggregate");
        assertTrue(started.await(5, TimeUnit.SECONDS));
        final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")}, "aggregate");

        assertTrue(service.cancel(jobB));
        final ExportJob.Snapshot snapB = service.status(jobB);
        assertEquals(ExportJob.Status.CANCELLED, snapB.status());
        assertEquals(0, snapB.processed(), "取消的 queued job 不得处理任何 replay");
        assertNull(store.get(jobB).artifactPath(), "取消的 queued job 不得有 artifact");

        // 释放 A 后让 C 入队并完成；B 的 Runnable 已从 queue 移除，processFull 绝不能被 B 触发
        final String jobC = service.createJob(new MultipartFile[]{file("c.wotbreplay")}, "aggregate");
        service.cancel(jobA);
        releaseA.countDown();
        awaitTerminal(jobA, 10_000);
        awaitTerminal(jobC, 10_000);
        assertFalse(processedNames.contains("b.wotbreplay"),
                "被取消的 queued job 不得执行任何 replay processing");
    }

    @Test
    void cancelDuringProcessingEndsInSingleTerminal() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(2, 2);
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);

        final CountDownLatch bStarted = new CountDownLatch(1);
        final CountDownLatch releaseB = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            bStarted.countDown();
            releaseB.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")}, "aggregate");
        assertTrue(bStarted.await(5, TimeUnit.SECONDS), "B 应进入 PROCESSING");

        // PROCESSING 中取消 → 协作取消（不中断线程），终态 CANCELLED 恰好一次
        assertTrue(service.cancel(jobB));
        releaseB.countDown();
        final ExportJob.Snapshot snap = awaitTerminal(jobB, 10_000);
        assertEquals(ExportJob.Status.CANCELLED, snap.status());
        final ExportJob job = store.get(jobB);
        assertFalse(job.markReady("x.xlsx", "m", null), "终态后不得再迁移到 READY");
        assertFalse(job.markFailed("X"), "终态后不得再迁移到 FAILED");
    }

    @Test
    void queuedCancellationRecordsTerminalObservabilityExactlyOnce() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, meterRegistry);

        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            releaseA.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")}, "aggregate");
        assertTrue(started.await(5, TimeUnit.SECONDS), "job A 应占用唯一 worker");
        final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")}, "aggregate");

        // QUEUED 取消：removeQueued 成功 → Runnable 永不执行 → 请求线程立即记录终态 observability
        assertTrue(service.cancel(jobB));
        final Counter cancelled = meterRegistry.get("wotb_replay_export_job_result_total")
                .tag("result", "cancelled").counter();
        assertEquals(1.0, cancelled.count(), "queued 取消必须立即记录 result_total{cancelled} 一次");

        // PROCESSING 协作取消由 worker 的 finishTerminal 记录，不得与 queued 记录重复
        service.cancel(jobA);
        releaseA.countDown();
        awaitTerminal(jobA, 10_000);
        assertEquals(2.0, cancelled.count(), "queued + processing 各恰好记录一次，不得重复");
        final Timer duration = meterRegistry.get("wotb_replay_export_job_duration_seconds")
                .tag("mode", "aggregate").timer();
        assertEquals(2L, duration.count(), "两次取消各记录一次 terminal duration");
    }

    // ---- PR #118 Blocker B：mode=each 流式（O(1) Battle working set）----

    @Test
    void eachStreamsThreeXlsxEntriesAllOpenableByPoi() throws Exception {
        stubFacadeBattlesDistinct();
        final String jobId = service.createJob(new MultipartFile[]{
                file("one.wotbreplay"), file("two.wotbreplay"), file("three.wotbreplay")}, "each");
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(3, snap.processed());
        final Path artifact = store.get(jobId).artifactPath();
        int count = 0;
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(artifact))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                assertTrue(entry.getName().endsWith(".xlsx"));
                // POI 的 XSSFWorkbook(InputStream) 会关闭传入流：先读 entry bytes 再打开（ZipInputStream 必须保持打开）。
                final byte[] entryBytes = zip.readAllBytes();
                try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(entryBytes))) {
                    assertEquals("玩家数据", wb.getSheetName(0), "每个 xlsx entry 必须可被 POI 打开");
                }
                count++;
            }
        }
        assertEquals(3, count);
    }

    @Test
    void eachStreamsSkipsInvalidReplayMidBatch() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final com.wotb.core.model.Source s = inv.getArgument(0);
            if (s.name().equals("bad.wotbreplay")) {
                throw new IllegalArgumentException("REPLAY_PROCESSING_FAILED");
            }
            return result(s.name(), "arena-" + s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("one.wotbreplay"), file("bad.wotbreplay"), file("three.wotbreplay")}, "each");
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(3, snap.processed());
        assertEquals(1, snap.failures());
        int entries = 0;
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(store.get(jobId).artifactPath()))) {
            while (zip.getNextEntry() != null) {
                entries++;
            }
        }
        assertEquals(2, entries, "中间无效 replay 跳过，ZIP 只含有效场");
    }

    @Test
    void eachWritesZipEntryBeforeProcessingNextReplay() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);

        final AtomicInteger calls = new AtomicInteger();
        final String[] jobIdRef = new String[1];
        final CountDownLatch firstCallDone = new CountDownLatch(1);
        final CountDownLatch goSecond = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final int n = calls.incrementAndGet();
            if (n == 1) {
                firstCallDone.countDown();
                goSecond.await(10, TimeUnit.SECONDS);
            } else if (n == 2 && jobIdRef[0] != null) {
                // 第 2 场开始 processFull 时，第 1 场的 XLSX 必须已写入 zip（流式证明）
                final Path zip = store.jobDir(jobIdRef[0]).resolve("result.zip");
                assertTrue(Files.exists(zip) && Files.size(zip) > 0,
                        "第 2 场处理开始时 zip 必须已含第 1 场 entry（O(1) working set）");
            }
            final com.wotb.core.model.Source s = inv.getArgument(0);
            return result(s.name(), "arena-" + s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("one.wotbreplay"), file("two.wotbreplay"), file("three.wotbreplay")}, "each");
        jobIdRef[0] = jobId;
        assertTrue(firstCallDone.await(5, TimeUnit.SECONDS));
        goSecond.countDown();
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(3, snap.processed());
    }

    // ---- PR #118 Blocker 1：输入顺序必须保持上传顺序（不得 filename 字典序）----

    @Test
    void eachPreservesUploadOrderAcrossThirtyFourReplays() throws Exception {
        stubFacadeBattlesDistinct();
        final MultipartFile[] files = new MultipartFile[34];
        final List<String> expected = new ArrayList<>();
        for (int i = 0; i < 34; i++) {
            files[i] = file("r" + i + ".wotbreplay");
            expected.add("r" + i + ".xlsx");
        }
        final String jobId = service.createJob(files, "each");
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 60_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(34, snap.processed());
        assertEquals(expected, zipEntryNames(jobId),
                "ZIP entry 顺序必须 = 上传顺序 0,1,...,9,10,...,33（字典序会得到 0,1,10,11,...,2,...）");
    }

    @Test
    void aggregatePreservesUploadOrderAcrossTwelveReplays() throws Exception {
        final List<String> processedOrder = new CopyOnWriteArrayList<>();
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final com.wotb.core.model.Source s = inv.getArgument(0);
            processedOrder.add(s.name());
            return result(s.name(), "arena-" + s.name());
        });
        final MultipartFile[] files = new MultipartFile[12];
        final List<String> expected = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            files[i] = file("g" + i + ".wotbreplay");
            expected.add("g" + i + ".wotbreplay");
        }
        final String jobId = service.createJob(files, "aggregate");
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 30_000);
        assertEquals(ExportJob.Status.READY, snap.status());
        assertEquals(12, snap.processed());
        assertEquals(expected, processedOrder,
                "aggregate 处理顺序必须 = 上传顺序（字典序会得到 0,1,10,11,...,2,...）");

        // battleSourceNames（战斗列表「文件名」列）必须与上传顺序一致
        final List<String> fileColumn = new ArrayList<>();
        try (Workbook wb = new XSSFWorkbook(Files.newInputStream(store.get(jobId).artifactPath()))) {
            final Sheet sheet = wb.getSheet("战斗列表");
            for (int i = 1; i <= sheet.getLastRowNum(); i++) {
                final Cell cell = sheet.getRow(i).getCell(7);
                if (cell != null && cell.getCellType() == CellType.STRING) {
                    fileColumn.add(cell.getStringCellValue());
                }
            }
        }
        assertEquals(expected, fileColumn, "aggregate 战斗列表文件名列必须保持上传顺序");
    }

    @Test
    void eachKeepsUploadOrderOfValidReplaysWhenInvalidInMiddle() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final com.wotb.core.model.Source s = inv.getArgument(0);
            if (s.name().equals("bad.wotbreplay")) {
                throw new IllegalArgumentException("REPLAY_PROCESSING_FAILED");
            }
            return result(s.name(), "arena-" + s.name());
        });
        final MultipartFile[] files = new MultipartFile[12];
        final List<String> expected = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            files[i] = i == 5 ? file("bad.wotbreplay") : file("r" + i + ".wotbreplay");
            if (i != 5) {
                expected.add("r" + i + ".xlsx");
            }
        }
        final String jobId = service.createJob(files, "each");
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 30_000);
        assertEquals(ExportJob.Status.READY, snap.status(), "存在有效 replay 时整体必须 READY");
        assertEquals(12, snap.processed());
        assertEquals(1, snap.failures());
        assertEquals(expected, zipEntryNames(jobId),
                "无效 replay 跳过（failures++），剩余有效 replay 仍保持原上传顺序");
    }

    // ---- PR #118 Blocker 2：artifact 写失败 = 整个 job FAILED（不得误判为单场失败）----

    @Test
    void eachZipWriteFailureFailsWholeJobAndRemovesPartialArtifact() throws Exception {
        stubFacadeBattlesDistinct();
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, meterRegistry) {
            @Override
            void writeSingleExcel(final Battle battle, final OutputStream out) throws IOException {
                throw new IOException("simulated disk full");
            }
        };
        final String jobId = service.createJob(new MultipartFile[]{
                file("a.wotbreplay"), file("b.wotbreplay")}, "each");
        final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ExportJob.Status.FAILED, snap.status(), "ZIP entry 写失败必须 FAILED，不得 READY");
        assertEquals("EXPORT_JOB_FAILED", snap.errorCode());
        assertFalse(Files.exists(store.jobDir(jobId).resolve("result.zip")),
                "partial ZIP 必须被删除（不暴露半包）");
        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.download(jobId));
        assertEquals(HttpStatus.CONFLICT, error.getStatusCode(), "FAILED job 不得提供下载");
    }

    @Test
    void unknownJobIsNotFound() {
        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.status("nope"));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
    }

    // ---- plan §28–§30 / §61：Export 复用 Processing Job result（不重新上传 / 不 processFull）----

    @Test
    void createFromProcessingResultAggregateReusesDatasetWithoutReprocessing() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-processing-reuse-test"), 60);
        try {
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);

            // 构造一个已 READY 的 Processing Job（含已解析 dataset）
            final String pJobId = "proc-1";
            final ReplayProcessingJob pJob = new ReplayProcessingJob(pJobId, 3);
            pJob.startProcessing();
            pJob.updateProgress(3, 1, 1);
            pJob.markReady(new ProcessedDataset(
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(new String[]{"dup.wotbreplay", "arena-1"}),
                    List.<String[]>of(new String[]{"bad.wotbreplay", "REPLAY_PROCESSING_FAILED"}),
                    null));
            processingStore.register(pJob);
            // Export acquire 引用（plan §52）
            processingStore.acquireForExport(pJobId);

            final String jobId = service.createJob(null, "aggregate", pJobId);
            final ExportJob.Snapshot snap = awaitTerminal(jobId, 10_000);
            assertEquals(ExportJob.Status.READY, snap.status());
            assertEquals(3, snap.total(), "total 与 Processing 输入总数一致");
            assertEquals(3, snap.processed(), "复用路径 processed 必须 == total");
            assertEquals(1, snap.duplicates());
            assertEquals(1, snap.failures());

            // 关键验收：facade.processFull 必须零次调用（plan §56/§61：Export 不再 processFull）
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
            final String pJobId = "proc-2";
            final ReplayProcessingJob pJob = new ReplayProcessingJob(pJobId, 2);
            pJob.startProcessing();
            pJob.updateProgress(2, 0, 0);
            pJob.markReady(new ProcessedDataset(
                    List.of(battle("arena-1"), battle("arena-2")),
                    List.of("one.wotbreplay", "two.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of(), null));
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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

    // ---- review BLOCKER 2：from-result each 的 valid 语义（processed 与 failures 不得相减）----

    @Test
    void fromResultEachWithOneValidOneFailureProducesZip() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b2-1v1f"), 60);
        try {
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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

    // ---- review BLOCKER 3：from-result Export 只读消费 ProcessedDataset（不再 mutate 共享 Battle）----

    @Test
    void fromResultExportsDoNotMutateProcessedDataset() throws Exception {
        final ReplayProcessingJobStore processingStore = new ReplayProcessingJobStore(
                Files.createTempDirectory("wotb-b3-nomutate"), 60);
        try {
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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

            // 关键：共享 Battle 未被 PotentialDamage.apply / populateBattle 修改
            assertEquals(0, b.players.getFirst().potentialDamage,
                    "PotentialDamage.apply 不得在 from-result 路径再次执行（damageDealt=5000 会被改写）");
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
            // 模拟 Processing Job 创建 dataset 前的 enrich invariant（plan §21/§27）
            final Battle b = battle("arena-1");
            b.players.getFirst().damageDealt = 5000;
            final List<Battle> battles = List.of(b);
            PotentialDamage.apply(battles, Tankopedia.load());
            for (final Battle battle : battles) {
                PerformanceMetricsCalculator.populateBattle(battle);
            }
            final int expectedPotential = b.players.getFirst().potentialDamage;
            assertTrue(expectedPotential == 5000, "测试前置：PotentialDamage 应把 potentialDamage 置为 damageDealt");
            assertNotNull(b.players.getFirst().contribution, "测试前置：HP 已知场 populateBattle 应回填 contribution");
            final String pJobId = readyProcessingJob(processingStore, "proc-parity",
                    battles, List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            final String aggJob = service.createJob(null, "aggregate", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(aggJob, 10_000).status());
            assertEquals(expectedPotential, b.players.getFirst().potentialDamage,
                    "from-result 导出不得改动已 enrich 的权威 metrics（Preview/Export parity）");
            assertNotNull(b.players.getFirst().contribution);
            final String eachJob = service.createJob(null, "each", pJobId);
            assertEquals(ExportJob.Status.READY, awaitTerminal(eachJob, 10_000).status());
            assertEquals(expectedPotential, b.players.getFirst().potentialDamage);
            assertNotNull(b.players.getFirst().contribution);
            verify(facade, times(0)).process(any(), eq(ReplayProcessingOptions.full()));
            processingStore.release(pJobId);
        } finally {
            deleteDir(processingStore.jobDir("proc-parity").getParent());
        }
    }

    // ---- review BLOCKER 2：acquire Processing result 后的 refcount ownership lifecycle ----

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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, failingStore,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
            final String pJobId = readyProcessingJobNoAcquire(processingStore, "proc-queuedcancel",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            // jobA 占住唯一 worker（multipart，facade 阻塞）
            final CountDownLatch started = new CountDownLatch(1);
            final CountDownLatch releaseA = new CountDownLatch(1);
            when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
                started.countDown();
                releaseA.await(10, TimeUnit.SECONDS);
                throw new IllegalArgumentException("NO_BATTLE_DATA");
            });
            final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")}, "aggregate");
            assertTrue(started.await(5, TimeUnit.SECONDS), "job A 应占用唯一 worker");

            // jobB：from-result → QUEUED（acquire +1，等 worker）
            final String jobB = service.createJob(null, "aggregate", pJobId);
            // QUEUED 取消 → removeQueued → 请求线程 release（review BLOCKER 2 语义保留）
            assertTrue(service.cancel(jobB));
            assertEquals(ExportJob.Status.CANCELLED, service.status(jobB).status());

            ageProcessingJob(processingStore.get(pJobId));
            processingStore.sweepExpired();
            assertNull(processingStore.get(pJobId), "QUEUED 取消后引用必须 release，TTL 可清理");

            // 清理 jobA（PROCESSING 协作取消）
            service.cancel(jobA);
            releaseA.countDown();
            awaitTerminal(jobA, 10_000);
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
            service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store,
                    executor, processingStore, meterRegistry);
            final String pJobId = readyProcessingJobNoAcquire(processingStore, "proc-submitreject",
                    List.of(battle("arena-1")), List.of("one.wotbreplay"),
                    List.<String[]>of(), List.<String[]>of());

            // jobA 占住唯一 worker，jobB 占满 queue
            final CountDownLatch started = new CountDownLatch(1);
            final CountDownLatch releaseA = new CountDownLatch(1);
            when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
                started.countDown();
                releaseA.await(10, TimeUnit.SECONDS);
                throw new IllegalArgumentException("NO_BATTLE_DATA");
            });
            final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")}, "aggregate");
            assertTrue(started.await(5, TimeUnit.SECONDS), "job A 应占用唯一 worker");
            final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")}, "aggregate");

            // jobC：from-result → acquire +1 → submit rejection → finally 必须 release
            assertThrows(ExportQueueFullException.class,
                    () -> service.createJob(null, "aggregate", pJobId));

            ageProcessingJob(processingStore.get(pJobId));
            processingStore.sweepExpired();
            assertNull(processingStore.get(pJobId), "submit rejection 后引用必须 release，TTL 可清理");

            // 清理 jobA / jobB
            service.cancel(jobB);
            service.cancel(jobA);
            releaseA.countDown();
            awaitTerminal(jobA, 10_000);
            awaitTerminal(jobB, 10_000);
        } finally {
            deleteDir(processingStore.jobDir("proc-submitreject").getParent());
        }
    }

    /** 构造并注册一个已 READY 的 Processing Job（不 acquire——让 createJob 成为唯一引用来源，便于断言 refcount balance）。 */
    private String readyProcessingJobNoAcquire(final ReplayProcessingJobStore processingStore, final String id,
                                              final List<Battle> battles, final List<String> names,
                                              final List<String[]> duplicates, final List<String[]> failures) {
        final int total = battles.size() + duplicates.size() + failures.size();
        final ReplayProcessingJob pJob = new ReplayProcessingJob(id, total);
        pJob.startProcessing();
        pJob.updateProgress(total, duplicates.size(), failures.size());
        pJob.markReady(new ProcessedDataset(battles, names, duplicates, failures, null));
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
        pJob.markReady(new ProcessedDataset(battles, names, duplicates, failures, null));
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

    // ---- helpers ----

    private void stubFacadeBattles() {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source source = inv.getArgument(0);
            return result(source.name(), "dup-arena");
        });
    }

    private void stubFacadeBattlesDistinct() {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source source = inv.getArgument(0);
            return result(source.name(), "arena-" + source.name());
        });
    }

    private ReplayProcessingResult result(final String name, final String arenaId) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.winnerTeam = 1;
        battle.players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = i + 1L;
            p.nickname = "p" + (i + 1);
            p.team = i < 7 ? 1 : 2;
            p.tankId = 4481L;
            battle.players.add(p);
        }
        return new ReplayProcessingResult(name, ReplayProcessingStatus.SUCCESS, null, battle,
                null, null, ReplayProcessingCapabilities.summaryOnly(false), null, null);
    }

    private static MultipartFile file(final String name) {
        return new MockMultipartFile("files", name, "application/octet-stream", new byte[]{1, 2, 3});
    }

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
