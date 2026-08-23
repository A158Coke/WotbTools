package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
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
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
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
import static org.mockito.Mockito.when;

/** Export Job 编排回归（plan §40–§43）：lifecycle / progress / artifact / 失败 / 取消。 */
class ReplayExportJobServiceTest {

    private Path tmpDir;
    private ExportJobStore store;
    private ReplayExportJobService service;
    private DefaultReplayProcessingFacade facade;
    private ReplayExportWorkerExecutor executor;

    @BeforeEach
    void setUp() throws Exception {
        tmpDir = Files.createTempDirectory("wotb-export-job-test");
        store = new ExportJobStore(tmpDir.toString(), 60);
        facade = mock(DefaultReplayProcessingFacade.class);
        executor = new ReplayExportWorkerExecutor(2, 4);
        service = new ReplayExportJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);
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

    @Test
    void unknownJobIsNotFound() {
        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.status("nope"));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
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
