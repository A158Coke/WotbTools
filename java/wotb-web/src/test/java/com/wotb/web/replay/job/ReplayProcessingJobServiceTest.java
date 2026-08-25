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
    private ReplayParseScheduler parseScheduler;
    private SimpleMeterRegistry meterRegistry;

    @BeforeEach
    void setUp() throws Exception {
        tmpDir = Files.createTempDirectory("wotb-processing-job-test");
        store = new ReplayProcessingJobStore(tmpDir, 60);
        facade = mock(DefaultReplayProcessingFacade.class);
        parseScheduler = new ReplayParseScheduler(2, 200);
        meterRegistry = new SimpleMeterRegistry();
        service = new ReplayProcessingJobService(facade, store, parseScheduler, meterRegistry);
    }

    @AfterEach
    void tearDown() {
        parseScheduler.close();
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
            b.settlementAccountsCoveredByRoster = true;
            b.settlementRosterTeamConsistent = true;
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
    void leagueJobReadyWithUnknownDeathTimeAndOtherFailures() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            final Battle b = leagueBattle(s.name());
            switch (s.name()) {
                case "m-death.wotbreplay" -> {
                    b.players.getFirst().survived = false;
                    b.players.getFirst().survivalTimeSec = 0; // 死亡时间 UNKNOWN（合法，照常评分）
                }
                case "m-roster.wotbreplay" -> b.settlementAccountsCoveredByRoster = false; // ROSTER_INCOMPLETE
                case "m-winner.wotbreplay" -> b.winnerTeam = null; // NO_DECISIVE_WINNER
                default -> { }
            }
            return leagueProcessingResult(b, s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("m-death.wotbreplay"), file("m-roster.wotbreplay"), file("m-winner.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status(),
                "全部 League replay 成功解析时 Job 必须 READY（P0 Blocker，禁止 NO_VALID_REPLAYS）");
        assertEquals(3, snap.valid(), "valid = 成功解析并可进入 Preview 的 replay 数");
        assertEquals(0, snap.failures(), "Rating 不合格不得计入解析失败（plan §18）");

        final ProcessedDataset ds = store.get(jobId).result();
        assertEquals(3, ds.battles().size(), "全部 Battle 必须保留在 dataset");
        assertEquals(1, ds.league().battleResults().size(), "死亡时间 UNKNOWN 场照常评分");
        assertEquals(2, ds.league().failures().size());
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
                b.settlementAccountsCoveredByRoster = false;
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

    // ---- plan §36：QUEUED 取消必须真正释放 scheduler pending 容量 ----

    @Test
    void cancelledQueuedJobFreesSchedulerCapacity() throws Exception {
        parseScheduler.close();
        parseScheduler = new ReplayParseScheduler(1, 2); // 1 worker + 2 pending 上限
        service = new ReplayProcessingJobService(facade, store, parseScheduler, null);

        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            started.countDown();
            releaseA.await(10, TimeUnit.SECONDS);
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        });
        final String jobA = service.createJob(new MultipartFile[]{file("a.wotbreplay")});
        assertTrue(started.await(5, TimeUnit.SECONDS), "job A 应占用唯一 worker");

        final String jobB = service.createJob(new MultipartFile[]{file("b1.wotbreplay"), file("b2.wotbreplay")});
        // 唯一 worker 被 A 占用；B 占满 pending 上限后，C 必须 503 PROCESSING_QUEUE_FULL
        assertThrows(ProcessingQueueFullException.class,
                () -> service.createJob(new MultipartFile[]{file("c.wotbreplay")}));

        // 取消 QUEUED 的 B → 必须立即释放 pending 容量
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
        parseScheduler.close();
        parseScheduler = new ReplayParseScheduler(1, 200); // 唯一 worker：B 必然排队
        service = new ReplayProcessingJobService(facade, store, parseScheduler, null);

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

    // ---- plan §59/§84：34 replay 并行处理，结果顺序必须恢复上传顺序 ----

    @Test
    void thirtyFourReplaysKeepResultOrderWithParallelProcessing() throws Exception {
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
        assertEquals(34, processedOrder.size(), "全部 34 个 source 都必须执行");

        // V2 并行：完成顺序允许乱序（plan §84），但最终业务顺序必须恢复上传顺序
        final ProcessedDataset ds = store.get(jobId).result();
        assertEquals(expected, ds.battleSourceNames());
        assertEquals(expected, snap.sources().stream()
                        .map(ReplayProcessingJob.SourceState::sourceName).toList(),
                "per-source 顺序必须保持上传顺序（不随并行完成顺序变化）");
    }

    // ---- plan §29/§31：真实 parse 进度（parseCompleted/parseSucceeded/parseFailed）与 FINALIZING_BATCH ----

    @Test
    void parseProgressAndFinalizingPhaseAreExposed() throws Exception {
        final CountDownLatch aStarted = new CountDownLatch(1);
        final CountDownLatch bStarted = new CountDownLatch(1);
        final CountDownLatch cStarted = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        final CountDownLatch releaseRest = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().startsWith("a")) {
                aStarted.countDown();
                releaseA.await(10, TimeUnit.SECONDS);
            }
            if (s.name().startsWith("b")) {
                bStarted.countDown();
            }
            if (s.name().startsWith("c")) {
                cStarted.countDown();
            }
            if (!s.name().startsWith("a")) {
                releaseRest.await(10, TimeUnit.SECONDS);
            }
            return result(s.name(), "arena-" + s.name());
        });

        final String jobId = service.createJob(new MultipartFile[]{
                file("a.wotbreplay"), file("b.wotbreplay"), file("c.wotbreplay")});

        // a 正在 full process：PROCESSING 阶段 parse 进度=0（尚未完成任何 replay）
        assertTrue(aStarted.await(5, TimeUnit.SECONDS));
        final ReplayProcessingJob.Snapshot processingSnap =
                awaitStatus(jobId, ReplayProcessingJob.Status.PROCESSING, 5_000);
        assertEquals(ReplayProcessingJob.PHASE_PROCESSING_REPLAYS, processingSnap.phase());
        assertEquals(0, processingSnap.parseCompleted(),
                "a 未完成时 parseCompleted 必须为 0（不得用 dedupe 计数冒充）");

        // 释放 a → parseCompleted=1 稳定可见（b/c 阻塞，避免窗口消失）
        assertTrue(bStarted.await(5, TimeUnit.SECONDS), "并发=2 时 a、b 应同时处理");
        releaseA.countDown();
        assertTrue(cStarted.await(5, TimeUnit.SECONDS), "a 完成后 c 应补位");
        final ReplayProcessingJob.Snapshot during = awaitParseCount(jobId, 1, 5_000);
        assertEquals(ReplayProcessingJob.Status.PROCESSING, during.status());
        assertEquals(ReplayProcessingJob.PHASE_PROCESSING_REPLAYS, during.phase());
        assertEquals(1, during.parseCompleted(), "parse 进度=真实完成数（不得被 dedupe 阶段吞掉）");
        assertEquals(1, during.parseSucceeded());
        assertEquals(0, during.parseFailed());

        releaseRest.countDown();
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(3, snap.parseCompleted());
        assertEquals(3, snap.parseSucceeded());
        assertEquals(0, snap.parseFailed());
        assertEquals(3, snap.valid());
    }

    // ---- BLOCKER 2：parse 进度单一原子状态权威（一致三元组 + 单调 + 中间态轮询）----

    @Test
    void twoWorkersCompletingSuccessAndSuccessKeepConsistentParseSnapshot() throws Exception {
        final CountDownLatch aStarted = new CountDownLatch(1);
        final CountDownLatch bStarted = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().startsWith("a")) {
                aStarted.countDown();
            }
            if (s.name().startsWith("b")) {
                bStarted.countDown();
            }
            release.await(10, TimeUnit.SECONDS); // 两个 worker 同时完成
            return result(s.name(), "arena-" + s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("a.wotbreplay"), file("b.wotbreplay")});
        assertTrue(aStarted.await(5, TimeUnit.SECONDS), "a 应占用第一个 worker");
        assertTrue(bStarted.await(5, TimeUnit.SECONDS), "b 应占用第二个 worker");

        release.countDown();
        final ReplayProcessingJob.Snapshot snap = awaitParseInvariants(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.parseCompleted());
        assertEquals(2, snap.parseSucceeded());
        assertEquals(0, snap.parseFailed());
        assertEquals(2, snap.valid());
    }

    @Test
    void twoWorkersCompletingSuccessAndFailureKeepConsistentParseSnapshot() throws Exception {
        final CountDownLatch aStarted = new CountDownLatch(1);
        final CountDownLatch bStarted = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().startsWith("a")) {
                aStarted.countDown();
            }
            if (s.name().startsWith("b")) {
                bStarted.countDown();
            }
            release.await(10, TimeUnit.SECONDS); // 两个 worker 同时完成
            if (s.name().startsWith("b")) {
                throw new IllegalArgumentException("REPLAY_PROCESSING_FAILED");
            }
            return result(s.name(), "arena-" + s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("a.wotbreplay"), file("b.wotbreplay")});
        assertTrue(aStarted.await(5, TimeUnit.SECONDS), "a 应占用第一个 worker");
        assertTrue(bStarted.await(5, TimeUnit.SECONDS), "b 应占用第二个 worker");

        release.countDown();
        final ReplayProcessingJob.Snapshot snap = awaitParseInvariants(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.parseCompleted());
        assertEquals(1, snap.parseSucceeded());
        assertEquals(1, snap.parseFailed());
        assertEquals(1, snap.valid());
        assertEquals(1, snap.failures());
    }

    // ---- BLOCKER 3：任何已注册 source 失败都必须产生 authoritative failed ParsedEntry ----

    @Test
    void inputStorageReadFailureProducesFailedParsedEntryAndConsistentDataset() throws Exception {
        parseScheduler.close();
        parseScheduler = new ReplayParseScheduler(1, 200); // 唯一 worker：可确定性破坏输入后再派发
        service = new ReplayProcessingJobService(facade, store, parseScheduler, null);
        final CountDownLatch blockerStarted = new CountDownLatch(1);
        final CountDownLatch releaseBlocker = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().equals("blocker.wotbreplay")) {
                blockerStarted.countDown();
                releaseBlocker.await(10, TimeUnit.SECONDS);
            }
            return result(s.name(), "arena-" + s.name());
        });
        service.createJob(new MultipartFile[]{file("blocker.wotbreplay")});
        assertTrue(blockerStarted.await(5, TimeUnit.SECONDS), "blocker 应占用唯一 worker");

        final String jobId = service.createJob(new MultipartFile[]{
                file("ok.wotbreplay"), file("bad.wotbreplay")});
        // B 仍排队：把 bad 输入替换成目录 → Files.readAllBytes 抛 IOException
        final Path badInput = ReplayJobFiles.listInputsInOrder(store.inputDir(jobId)).stream()
                .filter(p -> p.getFileName().toString().contains("bad"))
                .findFirst().orElseThrow();
        Files.delete(badInput);
        Files.createDirectory(badInput);

        releaseBlocker.countDown();
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.parseCompleted());
        assertEquals(1, snap.parseSucceeded());
        assertEquals(1, snap.parseFailed());
        assertEquals(1, snap.valid());
        assertEquals(1, snap.failures());
        final ReplayProcessingJob.SourceState badState = snap.sources().stream()
                .filter(s -> s.sourceName().equals("bad.wotbreplay")).findFirst().orElseThrow();
        assertEquals(ReplayProcessingJob.SourceStatus.FAILED, badState.status());
        assertEquals("PROCESSING_JOB_STORAGE_UNAVAILABLE", badState.failureMessage());

        final ProcessedDataset ds = store.get(jobId).result();
        assertTrue(ds.failures().stream().anyMatch(f -> f[0].equals("bad.wotbreplay")
                        && f[1].equals("PROCESSING_JOB_STORAGE_UNAVAILABLE")),
                "ProcessedDataset.failures 必须包含同一个失败文件");
        assertEquals(2, snap.processed(), "processed 必须最终 == total（失败也计入）");
    }

    @Test
    void artifactWriteFailureProducesFailedParsedEntryAndConsistentDataset() throws Exception {
        parseScheduler.close();
        parseScheduler = new ReplayParseScheduler(1, 200);
        service = new ReplayProcessingJobService(facade, store, parseScheduler, null);
        final CountDownLatch blockerStarted = new CountDownLatch(1);
        final CountDownLatch releaseBlocker = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().equals("blocker.wotbreplay")) {
                blockerStarted.countDown();
                releaseBlocker.await(10, TimeUnit.SECONDS);
            }
            return result(s.name(), "arena-" + s.name());
        });
        service.createJob(new MultipartFile[]{file("blocker.wotbreplay")});
        assertTrue(blockerStarted.await(5, TimeUnit.SECONDS));

        final String jobId = service.createJob(new MultipartFile[]{
                file("bad-artifact.wotbreplay"), file("ok.wotbreplay")});
        // B 仍排队：把 derived/r0 变成普通文件 → artifact 写 createDirectories 抛 IOException
        final Path derivedR0 = store.jobDir(jobId).resolve("derived").resolve("r0");
        Files.createDirectories(derivedR0.getParent());
        Files.writeString(derivedR0, "not-a-directory");

        releaseBlocker.countDown();
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.parseCompleted());
        assertEquals(1, snap.parseSucceeded());
        assertEquals(1, snap.parseFailed());
        final ReplayProcessingJob.SourceState failedState = snap.sources().stream()
                .filter(s -> s.sourceName().equals("bad-artifact.wotbreplay")).findFirst().orElseThrow();
        assertEquals(ReplayProcessingJob.SourceStatus.FAILED, failedState.status());
        assertEquals("PROCESSING_JOB_STORAGE_UNAVAILABLE", failedState.failureMessage());

        final ProcessedDataset ds = store.get(jobId).result();
        assertEquals(1, ds.failures().size());
        assertTrue(ds.failures().stream().anyMatch(f -> f[0].equals("bad-artifact.wotbreplay")
                        && f[1].equals("PROCESSING_JOB_STORAGE_UNAVAILABLE")),
                "ProcessedDataset.failures 必须包含同一个失败文件");
        assertEquals(1, ds.validCount());
        assertEquals(2, snap.processed());
    }

    @Test
    void parserFailureProducesFailedParsedEntryAndConsistentDataset() throws Exception {
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().equals("bad.wotbreplay")) {
                throw new IllegalArgumentException("REPLAY_PROCESSING_FAILED");
            }
            return result(s.name(), "arena-" + s.name());
        });
        final String jobId = service.createJob(new MultipartFile[]{
                file("ok.wotbreplay"), file("bad.wotbreplay")});

        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(2, snap.parseCompleted());
        assertEquals(1, snap.parseSucceeded());
        assertEquals(1, snap.parseFailed());
        assertEquals(1, snap.valid());
        assertEquals(1, snap.failures());
        final ReplayProcessingJob.SourceState badState = snap.sources().stream()
                .filter(s -> s.sourceName().equals("bad.wotbreplay")).findFirst().orElseThrow();
        assertEquals(ReplayProcessingJob.SourceStatus.FAILED, badState.status());
        assertEquals("REPLAY_PROCESSING_FAILED", badState.failureMessage());

        final ProcessedDataset ds = store.get(jobId).result();
        assertTrue(ds.failures().stream().anyMatch(f -> f[0].equals("bad.wotbreplay")
                && f[1].contains("REPLAY_PROCESSING_FAILED")));
    }

    // ---- plan §9/§42：sourceId/sourceIndex/per-source 状态与 activeSources[] ----

    @Test
    void sourceLevelStatesExposeSourceIdOrderAndActiveSources() throws Exception {
        final CountDownLatch aStarted = new CountDownLatch(1);
        final CountDownLatch bStarted = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            if (s.name().startsWith("a")) {
                aStarted.countDown();
            }
            if (s.name().startsWith("b")) {
                bStarted.countDown();
            }
            release.await(10, TimeUnit.SECONDS);
            return result(s.name(), "arena-" + s.name());
        });

        final String jobId = service.createJob(new MultipartFile[]{
                file("a.wotbreplay"), file("b.wotbreplay")});
        assertTrue(aStarted.await(5, TimeUnit.SECONDS));
        assertTrue(bStarted.await(5, TimeUnit.SECONDS), "并发=2 时两个 source 应同时处理");

        final ReplayProcessingJob.Snapshot during = service.status(jobId);
        assertEquals(2, during.sources().size());
        assertEquals("r0", during.sources().get(0).sourceId(), "sourceId 必须按上传顺序 = r{index}");
        assertEquals("a.wotbreplay", during.sources().get(0).sourceName());
        assertEquals(ReplayProcessingJob.SourceStatus.PROCESSING, during.sources().get(0).status());
        assertEquals(ReplayProcessingJob.SourceStatus.PROCESSING, during.sources().get(1).status());
        assertEquals(2, during.activeSources().size(),
                "两个 source 同时 PROCESSING → activeSources 必须同时包含两者");

        release.countDown();
        final ReplayProcessingJob.Snapshot done = awaitTerminal(jobId, 10_000);
        assertEquals(List.of("a.wotbreplay", "b.wotbreplay"),
                done.sources().stream().map(ReplayProcessingJob.SourceState::sourceName).toList(),
                "per-source 顺序必须保持上传顺序（不随完成顺序变化）");
        assertEquals(ReplayProcessingJob.SourceStatus.READY, done.sources().get(0).status());
        assertEquals(ReplayProcessingJob.SourceStatus.READY, done.sources().get(1).status());
    }

    // ---- plan §21/§22/§23：READY 前写 derived artifacts（MapOverview unavailable ≠ parse failure）----

    @Test
    void readyJobWritesDerivedArtifactsAndSkipsUnavailableMapOverview() throws Exception {
        stubFacadeBattlesDistinct(); // reconstruction=null → MapOverview unavailable
        final String jobId = service.createJob(new MultipartFile[]{file("a.wotbreplay")});
        final ReplayProcessingJob.Snapshot snap = awaitTerminal(jobId, 10_000);
        assertEquals(ReplayProcessingJob.Status.READY, snap.status());
        assertEquals(1, snap.valid());

        final Path jobDir = store.jobDir(jobId);
        assertTrue(Files.exists(ReplayArtifactWriter.aiFactsPath(jobDir, 0)),
                "READY 前必须先写 ai-facts.json（先写 artifact 后置 READY）");
        assertFalse(Files.exists(ReplayArtifactWriter.mapOverviewPath(jobDir, 0)),
                "MapOverview unavailable 时不得写伪 artifact，也不得判 parse failure");

        final com.wotb.core.replay.facts.AiReplayFacts facts =
                ReplayArtifactWriter.readAiFacts(jobDir, 0);
        assertEquals("a.wotbreplay", facts.fileName());
        assertEquals("arena-a.wotbreplay", facts.battle().arenaId);
    }

    // ---- plan §40–§43：prioritySourceIndex 目标 source 优先调度（不突破并发=2）----

    @Test
    void prioritySourceIndexSchedulesTargetFirst() throws Exception {
        parseScheduler.close();
        parseScheduler = new ReplayParseScheduler(1, 200); // 串行 worker：可观察执行顺序
        service = new ReplayProcessingJobService(facade, store, parseScheduler, null);
        final List<String> order = new CopyOnWriteArrayList<>();
        when(facade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final Source s = inv.getArgument(0);
            order.add(s.name());
            return result(s.name(), "arena-" + s.name());
        });

        final String jobId = service.createJob(new MultipartFile[]{
                file("r0.wotbreplay"), file("r1.wotbreplay"), file("r2.wotbreplay")}, 1);

        awaitTerminal(jobId, 10_000);
        assertEquals("r1.wotbreplay", order.getFirst(), "priority source 必须先执行（plan §41）");
        assertEquals(3, order.size());
        assertEquals(List.of("r0.wotbreplay", "r1.wotbreplay", "r2.wotbreplay"),
                service.status(jobId).sources().stream()
                        .map(ReplayProcessingJob.SourceState::sourceName).toList(),
                "业务顺序仍保持上传顺序");
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
        b.settlementAccountsCoveredByRoster = true;
        b.settlementRosterTeamConsistent = true;
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

    /** 轮询直到 parseCompleted >= expected（观察 PROCESSING 中间态）。 */
    private ReplayProcessingJob.Snapshot awaitParseCount(final String jobId, final int expected,
                                                         final long timeoutMs) throws InterruptedException {
        final long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            final ReplayProcessingJob.Snapshot snap = service.status(jobId);
            if (snap.parseCompleted() >= expected) {
                return snap;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("parseCompleted did not reach " + expected + " within " + timeoutMs + " ms");
    }

    /** 轮询直到 job 到达指定非终态（观察 PROCESSING 中间态）。 */
    private ReplayProcessingJob.Snapshot awaitStatus(final String jobId, final ReplayProcessingJob.Status status,
                                                     final long timeoutMs) throws InterruptedException {
        final long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            final ReplayProcessingJob.Snapshot snap = service.status(jobId);
            if (snap.status() == status) {
                return snap;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("job did not reach " + status + " within " + timeoutMs + " ms");
    }

    /** 轮询直到终态，每个中间 snapshot 都校验 parse 一致三元组 + 单调性（BLOCKER 2）。 */
    private ReplayProcessingJob.Snapshot awaitParseInvariants(final String jobId, final long timeoutMs)
            throws InterruptedException {
        final long deadline = System.currentTimeMillis() + timeoutMs;
        int lastCompleted = -1;
        int lastSucceeded = -1;
        int lastFailed = -1;
        while (System.currentTimeMillis() < deadline) {
            final ReplayProcessingJob.Snapshot snap = service.status(jobId);
            assertEquals(snap.parseCompleted(), snap.parseSucceeded() + snap.parseFailed(),
                    "parseCompleted 必须恒等于 parseSucceeded + parseFailed（一致三元组）");
            assertTrue(snap.parseCompleted() >= lastCompleted, "parseCompleted 不得下降");
            assertTrue(snap.parseSucceeded() >= lastSucceeded, "parseSucceeded 不得下降");
            assertTrue(snap.parseFailed() >= lastFailed, "parseFailed 不得下降");
            lastCompleted = snap.parseCompleted();
            lastSucceeded = snap.parseSucceeded();
            lastFailed = snap.parseFailed();
            if (snap.status() == ReplayProcessingJob.Status.READY
                    || snap.status() == ReplayProcessingJob.Status.FAILED
                    || snap.status() == ReplayProcessingJob.Status.CANCELLED) {
                return snap;
            }
            Thread.sleep(5);
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
