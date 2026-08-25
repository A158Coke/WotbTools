package com.wotb.web.replay.job;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 全局 ReplayParseScheduler 测试（plan §83：concurrency / single large job / fairness / cancellation / shutdown）。 */
class ReplayParseSchedulerTest {

    private ReplayParseScheduler scheduler;

    @AfterEach
    void tearDown() {
        if (scheduler != null) {
            scheduler.close();
        }
    }

    @Test
    void neverExceedsMaxConcurrentAcrossManyJobs() throws Exception {
        scheduler = new ReplayParseScheduler(2, 500);
        final AtomicInteger active = new AtomicInteger();
        final AtomicInteger maxSeen = new AtomicInteger();
        final CountDownLatch allDone = new CountDownLatch(6 * 3);
        for (int j = 0; j < 6; j++) {
            scheduler.submit("job" + j, List.of(0, 1, 2),
                    i -> {
                        maxSeen.accumulateAndGet(active.incrementAndGet(), Math::max);
                        Thread.sleep(20);
                        active.decrementAndGet();
                        allDone.countDown();
                    },
                    () -> { }, () -> { });
        }
        assertTrue(allDone.await(10, TimeUnit.SECONDS), "全部 source 应在超时前完成");
        assertEquals(0, active.get());
        assertTrue(maxSeen.get() <= 2, "全局并发不得超过 maxConcurrent=2，实际=" + maxSeen.get());
    }

    @Test
    void singleLargeJobRunsTwoSourcesConcurrently() throws Exception {
        scheduler = new ReplayParseScheduler(2, 100);
        final AtomicInteger active = new AtomicInteger();
        final AtomicInteger maxSeen = new AtomicInteger();
        final CountDownLatch done = new CountDownLatch(10);
        scheduler.submit("big", IntStream.range(0, 10).boxed().toList(),
                i -> {
                    maxSeen.accumulateAndGet(active.incrementAndGet(), Math::max);
                    Thread.sleep(10);
                    active.decrementAndGet();
                    done.countDown();
                },
                () -> { }, () -> { });
        assertTrue(done.await(10, TimeUnit.SECONDS));
        assertTrue(maxSeen.get() >= 2, "单个大 batch 必须能同时执行 2 个 source，实际=" + maxSeen.get());
    }

    @Test
    void smallJobIsNotStarvedBehindLargeJob() throws Exception {
        scheduler = new ReplayParseScheduler(2, 500);
        final CountDownLatch largeStarted = new CountDownLatch(1);
        final CountDownLatch allDone = new CountDownLatch(50);
        scheduler.submit("large", IntStream.range(0, 50).boxed().toList(),
                i -> {
                    allDone.countDown();
                    if (i == 0) {
                        largeStarted.countDown();
                        Thread.sleep(300);
                    }
                },
                () -> { }, () -> { });
        assertTrue(largeStarted.await(5, TimeUnit.SECONDS), "大 job 应先占用 slot");

        final CountDownLatch smallDone = new CountDownLatch(1);
        final List<String> smallOrder = new CopyOnWriteArrayList<>();
        scheduler.submit("small", List.of(0),
                i -> {
                    smallOrder.add("S0");
                    smallDone.countDown();
                },
                () -> { }, () -> { });
        assertTrue(smallDone.await(5, TimeUnit.SECONDS),
                "后来的 1-file Job 不得被 50-file Job 全批堵死（job-aware fairness）");
        assertTrue(allDone.await(10, TimeUnit.SECONDS), "大 job 全部 source 应完成");
        assertEquals(List.of("S0"), smallOrder);
    }

    @Test
    void cancelQueuedDropsPendingAndFreesCapacity() throws Exception {
        scheduler = new ReplayParseScheduler(1, 10);
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final AtomicInteger processed = new AtomicInteger();
        scheduler.submit("a", List.of(0),
                i -> {
                    started.countDown();
                    release.await(10, TimeUnit.SECONDS);
                    processed.incrementAndGet();
                },
                () -> { }, () -> { });
        assertTrue(started.await(5, TimeUnit.SECONDS));

        final List<Integer> queuedRuns = new CopyOnWriteArrayList<>();
        scheduler.submit("b", List.of(0, 1, 2),
                queuedRuns::add,
                () -> { }, () -> { });
        assertEquals(3, scheduler.queuedSources(), "B 的三个 source 应全部排队（唯一 worker 被 A 占用）");

        assertEquals(ReplayParseScheduler.CancellationResult.NO_COMPLETION_PENDING,
                scheduler.cancelQueued("b"), "无活跃 source 时取消应直接释放（onComplete 永不触发）");
        assertEquals(0, scheduler.queuedSources(), "取消后 pending 容量必须释放");

        release.countDown();
        awaitIdle(scheduler, 5_000);
        assertEquals(List.of(), queuedRuns, "被取消的 queued source 不得执行");
        assertEquals(1, processed.get());
    }

    @Test
    void processingCancelStopsDispatchingNewSources() throws Exception {
        scheduler = new ReplayParseScheduler(1, 10);
        final CountDownLatch firstStarted = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final List<Integer> runs = new CopyOnWriteArrayList<>();
        scheduler.submit("p", List.of(0, 1, 2, 3),
                i -> {
                    runs.add(i);
                    if (i == 0) {
                        firstStarted.countDown();
                        release.await(10, TimeUnit.SECONDS);
                    }
                },
                () -> { }, () -> { });
        assertTrue(firstStarted.await(5, TimeUnit.SECONDS));

        // PROCESSING 取消：丢弃尚未开始的 source（返回 false = 有活跃 source，onComplete 仍会触发）；
        // 已派发的 0 允许完成安全 unit
        assertEquals(3, scheduler.queuedSources());
        assertEquals(1, scheduler.activeSources(), "source 0 应在执行中");
        assertEquals(ReplayParseScheduler.CancellationResult.ACTIVE_COMPLETION_PENDING,
                scheduler.cancelQueued("p"), "存在活跃 source 时 onComplete 仍会触发");
        assertEquals(0, scheduler.queuedSources(), "取消后 pending 必须清空");
        release.countDown();
        awaitIdle(scheduler, 5_000);
        assertEquals(List.of(0), runs, "取消后不得开始新 source");
    }

    @Test
    void shutdownIsIdempotentAndDrainsWork() throws Exception {
        scheduler = new ReplayParseScheduler(2, 10);
        final CountDownLatch done = new CountDownLatch(4);
        scheduler.submit("s", List.of(0, 1, 2, 3),
                i -> done.countDown(),
                () -> { }, () -> { });
        assertTrue(done.await(5, TimeUnit.SECONDS));
        // runner body 先 countDown、finally 后完成记账 → 等调度器真正空闲再断言计数器。
        awaitIdle(scheduler, 5_000);
        assertEquals(0, scheduler.activeSources());
        assertEquals(0, scheduler.queuedSources());
        scheduler.close();
        scheduler.close(); // 幂等
    }

    // ---- BLOCKER 1：多线程 submit / 多 worker completion / submit+completion 竞态 / 取消竞态 / 公平性 ----

    @Test
    void concurrentSubmitsNeverExceedMaxConcurrentAndRunAll() throws Exception {
        scheduler = new ReplayParseScheduler(3, 500);
        final int submitterCount = 8;
        final int jobsPerSubmitter = 5;
        final int sourcesPerJob = 4;
        final AtomicInteger active = new AtomicInteger();
        final AtomicInteger maxSeen = new AtomicInteger();
        final AtomicInteger executed = new AtomicInteger();
        final CountDownLatch allDone = new CountDownLatch(submitterCount * jobsPerSubmitter * sourcesPerJob);
        final ExecutorService pool = Executors.newFixedThreadPool(submitterCount);
        try {
            for (int s = 0; s < submitterCount; s++) {
                final int submitter = s;
                pool.submit(() -> {
                    for (int j = 0; j < jobsPerSubmitter; j++) {
                        final String jobId = "t" + submitter + "-j" + j;
                        scheduler.submit(jobId, IntStream.range(0, sourcesPerJob).boxed().toList(),
                                i -> {
                                    maxSeen.accumulateAndGet(active.incrementAndGet(), Math::max);
                                    Thread.sleep(2);
                                    active.decrementAndGet();
                                    executed.incrementAndGet();
                                    allDone.countDown();
                                },
                                () -> { }, () -> { });
                    }
                    return null;
                });
            }
        } finally {
            pool.shutdown();
        }
        assertTrue(allDone.await(20, TimeUnit.SECONDS), "全部 source 应在超时前完成");
        awaitIdle(scheduler, 5_000);
        assertEquals(0, active.get());
        assertEquals(submitterCount * jobsPerSubmitter * sourcesPerJob, executed.get());
        assertTrue(maxSeen.get() <= 3, "并发 submit 下全局并发不得超过 maxConcurrent=3，实际=" + maxSeen.get());
    }

    @Test
    void submitAndCompletionRaceKeepsSchedulerInvariants() throws Exception {
        scheduler = new ReplayParseScheduler(2, 1000); // 容量需 ≥ 全部 job 的 pending 总和（60+360）
        final AtomicInteger active = new AtomicInteger();
        final AtomicInteger maxSeen = new AtomicInteger();
        final AtomicInteger executed = new AtomicInteger();
        final CountDownLatch allDone = new CountDownLatch(420); // 60 large + 6×30×2 small
        // 先提交一个大 job 占用 slot，随后并发提交小 job（submit 与 completion 同时发生）。
        scheduler.submit("large", IntStream.range(0, 60).boxed().toList(),
                i -> {
                    maxSeen.accumulateAndGet(active.incrementAndGet(), Math::max);
                    Thread.sleep(1);
                    active.decrementAndGet();
                    executed.incrementAndGet();
                    allDone.countDown();
                },
                () -> { }, () -> { });
        final ExecutorService pool = Executors.newFixedThreadPool(6);
        try {
            for (int t = 0; t < 6; t++) {
                final int submitter = t;
                pool.submit(() -> {
                    for (int j = 0; j < 30; j++) {
                        scheduler.submit("race-" + submitter + "-" + j, List.of(0, 1),
                                i -> {
                                    maxSeen.accumulateAndGet(active.incrementAndGet(), Math::max);
                                    Thread.sleep(1);
                                    active.decrementAndGet();
                                    executed.incrementAndGet();
                                    allDone.countDown();
                                },
                                () -> { }, () -> { });
                    }
                    return null;
                });
            }
        } finally {
            pool.shutdown();
        }
        final long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            // 不变量：reserved/running ≤ maxConcurrent；ready 成员资格唯一（≤ registered jobs）；
            // queuedJobs/queuedSources 非负。
            assertTrue(scheduler.activeSources() <= 2,
                    "activeSources 不得超过 maxConcurrent，实际=" + scheduler.activeSources());
            assertTrue(scheduler.queuedJobs() <= Math.max(1, scheduler.registeredJobs().size()),
                    "同一 job 不得重复出现在 ready 队列（queuedJobs > registered jobs）");
            if (allDone.getCount() == 0) {
                break;
            }
            Thread.sleep(5);
        }
        assertTrue(allDone.await(10, TimeUnit.SECONDS), "全部 source 应在超时前完成");
        awaitIdle(scheduler, 5_000);
        assertEquals(420, executed.get());
        assertTrue(maxSeen.get() <= 2, "submit+completion 竞态下并发不得超过 2，实际=" + maxSeen.get());
    }

    @Test
    void roundRobinDispatchesEachJobAtMostOncePerTurn() throws Exception {
        scheduler = new ReplayParseScheduler(1, 200); // 单 worker：每回合只派发一个 source
        final CountDownLatch aStarted = new CountDownLatch(1);
        final CountDownLatch releaseA = new CountDownLatch(1);
        final List<String> order = new CopyOnWriteArrayList<>();
        final CountDownLatch allDone = new CountDownLatch(60);
        scheduler.submit("A", IntStream.range(0, 30).boxed().toList(),
                i -> {
                    order.add("A");
                    if (i == 0) {
                        aStarted.countDown();
                        releaseA.await(10, TimeUnit.SECONDS);
                    }
                    allDone.countDown();
                },
                () -> { }, () -> { });
        assertTrue(aStarted.await(5, TimeUnit.SECONDS));
        scheduler.submit("B", IntStream.range(0, 30).boxed().toList(),
                i -> {
                    order.add("B");
                    allDone.countDown();
                },
                () -> { }, () -> { });
        releaseA.countDown();
        assertTrue(allDone.await(10, TimeUnit.SECONDS), "两个 job 的全部 source 应完成");
        awaitIdle(scheduler, 5_000);
        // 单 worker + 每 job 至多一个 ready 成员 → 严格确定序列：
        // A0,A1 先发（B 尚未提交）；随后 B、A 每回合交替，A 耗尽后 B 收尾。
        // 若 dispatch/completion 重复 offer，同一 job 会连续多回合，序列立即偏离。
        final List<String> expected = new java.util.ArrayList<>();
        expected.add("A");
        expected.add("A");
        for (int k = 0; k < 28; k++) {
            expected.add("B");
            expected.add("A");
        }
        expected.add("B");
        expected.add("B");
        assertEquals(expected, order, "round-robin 每回合每个 job 至多派发一次（无重复 ready 成员）");
    }

    @Test
    void cancelAndCompletionRaceIsConsistent() throws Exception {
        scheduler = new ReplayParseScheduler(1, 50);
        for (int round = 0; round < 20; round++) {
            final String blockingId = "block-" + round;
            final String targetId = "target-" + round;
            final CountDownLatch started = new CountDownLatch(1);
            final CountDownLatch release = new CountDownLatch(1);
            final AtomicInteger targetRuns = new AtomicInteger();
            scheduler.submit(blockingId, List.of(0),
                    i -> {
                        started.countDown();
                        release.await(10, TimeUnit.SECONDS);
                    },
                    () -> { }, () -> { });
            assertTrue(started.await(5, TimeUnit.SECONDS), "blocking source 应占用唯一 worker");
            scheduler.submit(targetId, List.of(0),
                    i -> targetRuns.incrementAndGet(),
                    () -> { }, () -> { });
            assertEquals(1, scheduler.queuedSources(), "target 应排队");

            // 取消与 completion 同时竞争唯一 slot：取消赢 → target 永不执行；
            // completion 赢 → target 恰好执行一次。两种结果都必须与返回值一致。
            final ExecutorService pool = Executors.newFixedThreadPool(2);
            final ReplayParseScheduler.CancellationResult[] cancelResult = {null};
            final CountDownLatch bothDone = new CountDownLatch(2);
            try {
                pool.submit(() -> {
                    cancelResult[0] = scheduler.cancelQueued(targetId);
                    bothDone.countDown();
                    return null;
                });
                pool.submit(() -> {
                    release.countDown();
                    bothDone.countDown();
                    return null;
                });
                assertTrue(bothDone.await(5, TimeUnit.SECONDS));
            } finally {
                pool.shutdownNow();
            }
            if (cancelResult[0] == ReplayParseScheduler.CancellationResult.NO_COMPLETION_PENDING) {
                assertEquals(0, targetRuns.get(), "cancelQueued=true 时 target 不得执行任何 source");
            } else {
                assertEquals(1, targetRuns.get(), "cancelQueued=false 时 target 应恰好执行一次");
            }
            awaitIdle(scheduler, 5_000);
        }
    }

    @Test
    void stressManyJobsPreserveReservationAndMembershipInvariants() throws Exception {
        scheduler = new ReplayParseScheduler(3, 500);
        final int jobs = 40;
        final AtomicInteger executed = new AtomicInteger();
        final AtomicInteger expectedTotal = new AtomicInteger();
        final ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            for (int t = 0; t < 4; t++) {
                final int submitter = t;
                pool.submit(() -> {
                    for (int j = 0; j < jobs / 4; j++) {
                        final int size = 1 + (j * submitter) % 6;
                        expectedTotal.addAndGet(size);
                        final String jobId = "stress-" + submitter + "-" + j;
                        final CountDownLatch jobDone = new CountDownLatch(1);
                        scheduler.submit(jobId, IntStream.range(0, size).boxed().toList(),
                                i -> {
                                    Thread.sleep(1);
                                    executed.incrementAndGet();
                                },
                                () -> { }, jobDone::countDown);
                        try {
                            jobDone.await(10, TimeUnit.SECONDS);
                        } catch (final InterruptedException e) {
                            Thread.currentThread().interrupt();
                            throw new RuntimeException(e);
                        }
                    }
                    return null;
                });
            }
        } finally {
            pool.shutdown();
        }
        // 4 个 submitter 各自等待 jobDone（内部 drain）→ 全部完成后统一断言。
        final long deadline = System.currentTimeMillis() + 30_000;
        while (executed.get() < expectedTotal.get() && System.currentTimeMillis() < deadline) {
            assertTrue(scheduler.activeSources() <= 3,
                    "stress 下 activeSources 不得超过 3，实际=" + scheduler.activeSources());
            assertTrue(scheduler.queuedJobs() <= Math.max(1, scheduler.registeredJobs().size()),
                    "同一 job 不得重复出现在 ready 队列");
            Thread.sleep(5);
        }
        awaitIdle(scheduler, 5_000);
        assertEquals(expectedTotal.get(), executed.get(), "全部 source 必须恰好执行一次");
        assertEquals(0, scheduler.activeSources());
        assertEquals(0, scheduler.queuedSources());
        assertEquals(0, scheduler.queuedJobs());
    }

    private static void awaitIdle(final ReplayParseScheduler scheduler, final long timeoutMs) throws InterruptedException {
        final long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (scheduler.activeSources() == 0 && scheduler.queuedSources() == 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("scheduler 未在 " + timeoutMs + " ms 内空闲");
    }
}
