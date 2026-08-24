package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.web.replay.dto.PreviewResponse;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

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

/** Replay Processing Job 编排回归（plan §57–§62）：lifecycle / progress / 顺序 / 取消 / exactly-once / 复用 / TTL。 */
class ReplayProcessingJobServiceTest {

    private Path tmpDir;
    private ReplayProcessingJobStore store;
    private ReplayProcessingJobService service;
    private DefaultReplayProcessingFacade facade;
    private ReplayExportWorkerExecutor executor;
    private SimpleMeterRegistry meterRegistry;

    @BeforeEach
    void setUp() throws Exception {
        tmpDir = Files.createTempDirectory("wotb-processing-job-test");
        store = new ReplayProcessingJobStore(tmpDir, 60);
        facade = mock(DefaultReplayProcessingFacade.class);
        executor = new ReplayExportWorkerExecutor(2, 4);
        meterRegistry = new SimpleMeterRegistry();
        service = new ReplayProcessingJobService(new ReplayCapacityLimiter(2), facade, store, executor, meterRegistry);
    }

    @AfterEach
    void tearDown() {
        executor.close();
        store.close();
        deleteDir(tmpDir);
    }

    @Test
    void createJobRunsToReadyWithProcessedDataset() throws Exception {
        stubFacadeBattlesDistinct();
        final String jobId = service.createJob(new MultipartFile[]{file("battle-a.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(1, snap.total());
        assertEquals(1, snap.processed());
        assertEquals(1, snap.valid());
        assertEquals(0, snap.duplicates());
        assertEquals(0, snap.failures());

        final ProcessedDataset ds = store.get(jobId).result();
        assertNotNull(ds, "READY 后必须持有 ProcessedDataset（plan §22）");
        assertEquals(1, ds.validCount());
        assertEquals("battle-a.wotbreplay", ds.battleSourceNames().getFirst());
    }

    @Test
    void aggregateDeduplicatesAndCountsProgress() throws Exception {
        stubFacadeBattles();  // same arena for all names
        final String jobId = service.createJob(new MultipartFile[]{
                file("dup-a.wotbreplay"), file("dup-b.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.total());
        assertEquals(2, snap.processed(), "重复文件也推进 processed（plan §10）");
        assertEquals(1, snap.valid());
        assertEquals(1, snap.duplicates());
        assertEquals(0, snap.failures());
    }

    @Test
    void mixedOutcomeCountsValidDuplicateFailureCorrectly() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().equals("bad.wotbreplay")) {
                throw new IllegalArgumentException("REPLAY_PROCESSING_FAILED");
            }
            return result(s.name(), "shared-arena");  // valid 场共享同一 arena → 首场有效，其余重复
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("one.wotbreplay"), file("bad.wotbreplay"), file("three.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status(), "存在有效 replay 时整体 READY（plan §38）");
        assertEquals(3, snap.total());
        assertEquals(3, snap.processed(), "processed 必须最终 == total（即使存在失败，plan §10）");
        assertEquals(1, snap.valid());
        assertEquals(1, snap.duplicates());
        assertEquals(1, snap.failures());
    }

    @Test
    void leagueBattleReadyCarriesLeagueDataset() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            final Battle b = new Battle();
            b.arenaId = "arena-" + s.name();
            b.arenaBonusType = 2;
            b.winnerTeam = 1;
            b.rosterComplete = true;
            b.players = new ArrayList<>();
            for (int i = 0; i < 14; i++) {
                final PlayerResult p = new PlayerResult();
                p.accountId = i + 1L;
                p.nickname = "p" + (i + 1);
                p.team = i < 7 ? 1 : 2;
                p.tankId = 4481L;
                p.survived = true;
                p.survivalTimeSec = 300;
                b.players.add(p);
            }
            return new ReplayProcessingResult(s.name(), ReplayProcessingStatus.SUCCESS, null, b,
                    null, null, ReplayProcessingCapabilities.summaryOnly(false), null, null);
        });
        final String jobId = service.createJob(new MultipartFile[]{file("league.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        final ProcessedDataset ds = store.get(jobId).result();
        assertNotNull(ds.league(), "League 模式 dataset 必须携带 LeagueRatingBatch");
        assertEquals(1, ds.league().battleResults().size());
        assertTrue(ds.league().battleResults().getFirst().rated());
    }

    // ---- P0 回归：League Rating 校验失败不得删除 Battle / 不得触发 NO_VALID_REPLAYS ----

    @Test
    void allLeagueBattlesRatingIneligibleJobStillReady() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            final Battle b = leagueBattle(s.name());
            switch (s.name()) {
                case "m-death.wotbreplay" -> {
                    b.players.getFirst().survived = false;
                    b.players.getFirst().survivalTimeSec = 0; // MISSING_DEATH_TIME
                }
                case "m-roster.wotbreplay" -> b.rosterComplete = false; // ROSTER_INCOMPLETE
                case "m-winner.wotbreplay" -> b.winnerTeam = null; // NO_DECISIVE_WINNER
                default -> { }
            }
            return leagueProcessingResult(b, s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("m-death.wotbreplay"), file("m-roster.wotbreplay"), file("m-winner.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status(),
                "全部 League replay 成功解析但全部 Rating 不合格时 Job 必须 READY（P0 Blocker，禁止 NO_VALID_REPLAYS）");
        assertEquals(3, snap.valid(), "valid = 成功解析并可进入 Preview 的 replay 数");
        assertEquals(0, snap.failures(), "Rating 不合格不得计入解析失败（plan §18）");

        final ProcessedDataset ds = store.get(jobId).result();
        assertEquals(3, ds.battles().size(), "全部 Rating-ineligible Battle 必须保留在 dataset");
        assertEquals(0, ds.league().battleResults().size());
        assertEquals(3, ds.league().failures().size());
        assertEquals(1, ds.league().failures().stream()
                .filter(f -> f.code().equals(com.wotb.core.league.LeagueFailure.Code.MISSING_DEATH_TIME)).count());
        assertEquals(1, ds.league().failures().stream()
                .filter(f -> f.code().equals(com.wotb.core.league.LeagueFailure.Code.ROSTER_INCOMPLETE)).count());
        assertEquals(1, ds.league().failures().stream()
                .filter(f -> f.code().equals(com.wotb.core.league.LeagueFailure.Code.NO_DECISIVE_WINNER)).count());
    }

    @Test
    void partialLeagueRatingsJobReadyKeepsAllBattles() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            final Battle b = leagueBattle(s.name());
            if (s.name().equals("p-bad.wotbreplay")) {
                b.rosterComplete = false;
            }
            return leagueProcessingResult(b, s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("p-good.wotbreplay"), file("p-bad.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.valid());
        assertEquals(0, snap.failures());

        final ProcessedDataset ds = store.get(jobId).result();
        assertEquals(2, ds.battles().size(), "eligible + ineligible 两场都必须进入 Preview battles");
        assertEquals(1, ds.league().battleResults().size(), "Rating 只对 eligible 场次计算");
        assertEquals(1, ds.league().failures().size());
    }

    @Test
    void mixedLeagueAndStandardJobReadyKeepsAllBattles() throws Exception {
        // plan §21/Case I：混合批次 Processing Job 必须 READY（禁止 mixed 污染 Processing Job）；
        // League Rating 不聚合，battles 按普通回放语义成功返回，dataset 携带 leagueUnavailableCode。
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            final Battle b = new Battle();
            b.arenaId = "arena-" + s.name();
            b.arenaBonusType = s.name().startsWith("t") ? 2 : 1;
            b.players = List.of();
            return new ReplayProcessingResult(s.name(), ReplayProcessingStatus.SUCCESS, null, b,
                    null, null, ReplayProcessingCapabilities.summaryOnly(false), null, null);
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("t-training.wotbreplay"), file("r-random.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status(),
                "混合批次必须 READY（§21：禁止 mixed League eligibility 使 Processing Job FAILED）");
        assertEquals(0, snap.failures(), "混合批次无解析失败时 failures 必须为 0");
        assertEquals(2, snap.valid(), "混合批次两个已解析文件都计有效");
        final PreviewResponse r = service.result(jobId);
        assertNotNull(r, "混合批次 result 必须可用（preview 可展示全部 battles）");
        assertEquals("MIXED_LEAGUE_AND_STANDARD_REPLAYS", r.leagueUnavailableCode());
        assertEquals(2, r.battles().size());
        assertNull(r.league(), "混合批次不产生 League Rating 元数据");
        assertTrue(r.failures().isEmpty());
    }

    @Test
    void noValidReplaysFailsWithStableErrorCode() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full())))
                .thenThrow(new IllegalArgumentException("REPLAY_PROCESSING_FAILED"));
        final String jobId = service.createJob(new MultipartFile[]{file("bad.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.FAILED, snap.status());
        assertEquals("NO_VALID_REPLAYS", snap.errorCode(), "0 场有效必须 FAILED + 稳定错误码（plan §39）");
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
        final String jobId = service.createJob(new MultipartFile[]{file("block.wotbreplay")});
        assertTrue(started.await(5, TimeUnit.SECONDS), "job 应开始处理");

        assertTrue(service.cancel(jobId), "PROCESSING 中取消应请求成功");
        release.countDown();

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.CANCELLED, snap.status(), "协作取消后 worker 应终态 CANCELLED");
    }

    // ---- plan §36：QUEUED 取消必须真正释放 executor queue slot ----

    @Test
    void cancelledQueuedJobFreesQueueCapacity() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        service = new ReplayProcessingJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);

        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            releaseA.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")});
        assertTrue(started.await(5, TimeUnit.SECONDS), "job A 应占用唯一 worker");

        final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")});
        // workers=1 + queue=1 已满 → C 必须 503 PROCESSING_QUEUE_FULL
        assertThrows(ProcessingQueueFullException.class,
                () -> service.createJob(new MultipartFile[]{file("c.wotbreplay")}));

        // 取消 QUEUED 的 B → 必须立即释放 queue slot
        assertTrue(service.cancel(jobB));
        assertEquals(ReplayProcessingJob.Status.CANCELLED, service.status(jobB).status());

        // 立即创建 C → 必须 ACCEPTED（不再 PROCESSING_QUEUE_FULL）
        final String jobC = service.createJob(new MultipartFile[]{file("c.wotbreplay")});
        assertNotNull(jobC, "取消 QUEUED job 后新 job 必须能立即入队");

        service.cancel(jobA);
        releaseA.countDown();
        awaitTerminal(jobA, 10_000);
        awaitTerminal(jobC, 10_000);
    }

    @Test
    void cancelledQueuedJobNeverProcessesReplay() throws Exception {
        executor.close();
        executor = new ReplayExportWorkerExecutor(1, 1);
        service = new ReplayProcessingJobService(new ReplayCapacityLimiter(2), facade, store, executor, null);

        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        final List<String> processedNames = new CopyOnWriteArrayList<>();
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            processedNames.add(s.name());
            if (s.name().startsWith("a")) {
                started.countDown();
                releaseA.await(10, TimeUnit.SECONDS);
            }
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")});
        assertTrue(started.await(5, TimeUnit.SECONDS));
        final String jobB = service.createJob(new MultipartFile[]{file("b.wotbreplay")});

        assertTrue(service.cancel(jobB));
        final ReplayProcessingJob.Snapshot snapB = service.status(jobB);
        assertEquals(ReplayProcessingJob.Status.CANCELLED, snapB.status());
        assertEquals(0, snapB.processed(), "取消的 queued job 不得处理任何 replay");

        final String jobC = service.createJob(new MultipartFile[]{file("c.wotbreplay")});
        service.cancel(jobA);
        releaseA.countDown();
        awaitTerminal(jobA, 10_000);
        awaitTerminal(jobC, 10_000);
        assertFalse(processedNames.contains("b.wotbreplay"),
                "被取消的 queued job 不得执行任何 replay processing");
    }

    // ---- plan §59：34 replay 上传顺序 + 进度 ----

    @Test
    void thirtyFourReplaysKeepUploadOrderAndReachFullProgress() throws Exception {
        stubFacadeBattlesDistinct();
        final List<String> processedOrder = new CopyOnWriteArrayList<>();
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            processedOrder.add(s.name());
            return result(s.name(), "arena-" + s.name());
        });
        final MultipartFile[] files = new MultipartFile[34];
        final List<String> expected = new ArrayList<>();
        for (int i = 0; i < 34; i++) {
            files[i] = file("r" + i + ".wotbreplay");
            expected.add("r" + i + ".wotbreplay");
        }
        final String jobId = service.createJob(files);
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 60_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(34, snap.processed(), "processed 必须最终 == 34");
        assertEquals(34, snap.valid());
        assertEquals(expected, processedOrder,
                "处理顺序必须 = 上传顺序 0,1,...,9,10,...,33（字典序会得到 0,1,10,11,...,2,...）");

        // result 的 battleSourceNames 与上传顺序一致
        final ProcessedDataset ds = store.get(jobId).result();
        assertEquals(expected, ds.battleSourceNames());
    }

    // ---- plan §57：exactly once processing（Preview/result/Export 不得二次 processFull）----

    @Test
    void processingExecutesEachReplayExactlyOnceAndResultDoesNotReprocess() throws Exception {
        stubFacadeBattlesDistinct();
        final int n = 12;
        final MultipartFile[] files = new MultipartFile[n];
        for (int i = 0; i < n; i++) {
            files[i] = file("g" + i + ".wotbreplay");
        }
        final String jobId = service.createJob(files);
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 30_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        // exactly once：Processing Job 本身恰好 processFull ×N（plan §56）
        verify(facade, times(n)).process(any(), eq(ReplayProcessingOptions.full()));

        // GET result 不重新解析：再次读取后调用数仍 == N（plan §21/§61）
        final PreviewResponse preview = service.result(jobId);
        assertEquals(n, preview.battles().size());
        assertEquals(0, preview.duplicates().size());
        verify(facade, times(n)).process(any(), eq(ReplayProcessingOptions.full()));
    }

    @Test
    void resultBeforeReadyIsConflict() throws Exception {
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            release.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobId = service.createJob(new MultipartFile[]{file("block.wotbreplay")});
        assertTrue(started.await(5, TimeUnit.SECONDS));

        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.result(jobId));
        assertEquals(HttpStatus.CONFLICT, error.getStatusCode(), "未 READY 读取 result 必须 409");

        service.cancel(jobId);
        release.countDown();
        awaitTerminal(jobId, 10_000);
    }

    @Test
    void unknownJobIsNotFound() {
        final ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.status("nope"));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
    }

    @Test
    void statusReportsCurrentFileDuringProcessing() throws Exception {
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            release.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobId = service.createJob(new MultipartFile[]{file("block.wotbreplay")});
        assertTrue(started.await(5, TimeUnit.SECONDS));

        final ReplayProcessingJob.Snapshot snap = service.status(jobId);
        assertEquals(ReplayProcessingJob.Status.PROCESSING, snap.status());
        assertEquals("block.wotbreplay", snap.currentFile(), "PROCESSING 期间应显示当前处理文件（plan §12）");

        service.cancel(jobId);
        release.countDown();
        awaitTerminal(jobId, 10_000);
    }

    // ---- plan §62：TTL cleanup 不得误删被活跃 Export 引用的 result ----

    @Test
    void ttlCleanupSkipsAcquiredResultAndRemovesReleased() throws Exception {
        stubFacadeBattlesDistinct();
        final String jobId = service.createJob(new MultipartFile[]{file("a.wotbreplay")});
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());

        // Export 引用该 result（plan §52）：即使过期也不得清理
        final ReplayProcessingJob acquired = store.acquireForExport(jobId);
        assertNotNull(acquired, "READY job 应可被 Export acquire");
        ageJob(store.get(jobId), 61 * 60 * 1000L);
        store.sweepExpired();
        assertNotNull(store.get(jobId), "被活跃 Export 引用的 result 不得被 TTL 清理");

        // Export 结束 release 后：TTL 过期 → 清理
        store.release(jobId);
        store.sweepExpired();
        assertNull(store.get(jobId), "release 且过期后必须被清理");
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

    /** 合法 7v7 league battle（arenaBonusType=2；可再改字段制造校验失败）。 */
    private static Battle leagueBattle(final String name) {
        final Battle b = new Battle();
        b.arenaId = "arena-" + name;
        b.arenaBonusType = 2;
        b.winnerTeam = 1;
        b.rosterComplete = true;
        b.players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = i + 1L;
            p.nickname = "p" + (i + 1);
            p.team = i < 7 ? 1 : 2;
            p.tankId = 4481L;
            p.survived = true;
            p.survivalTimeSec = 300;
            b.players.add(p);
        }
        return b;
    }

    private static ReplayProcessingResult leagueProcessingResult(final Battle battle, final String name) {
        return new ReplayProcessingResult(name, ReplayProcessingStatus.SUCCESS, null, battle,
                null, null, ReplayProcessingCapabilities.summaryOnly(false), null, null);
    }

    private static MultipartFile file(final String name) {
        return new MockMultipartFile("files", name, "application/octet-stream", new byte[]{1, 2, 3});
    }

    /** 把 job 的 finishedAt 拨旧，模拟 TTL 过期（终态时间戳为内部状态，测试经反射调整）。 */
    private static void ageJob(final ReplayProcessingJob job, final long millis) throws Exception {
        final Field stateField = ReplayProcessingJob.class.getDeclaredField("state");
        stateField.setAccessible(true);
        final Object state = stateField.get(job);
        final Field finishedField = state.getClass().getDeclaredField("finishedAtMillis");
        finishedField.setAccessible(true);
        finishedField.setLong(state, System.currentTimeMillis() - millis);
    }

    private ReplayProcessingJob.Snapshot awaitTerminal(final String jobId, final long timeoutMs) throws InterruptedException {
        final long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            final ReplayProcessingJob job = store.get(jobId);
            if (job != null) {
                final ReplayProcessingJob.Snapshot snap = job.snapshot();
                if (snap.status() == ReplayProcessingJob.Status.READY
                        || snap.status() == ReplayProcessingJob.Status.FAILED
                        || snap.status() == ReplayProcessingJob.Status.CANCELLED) {
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
