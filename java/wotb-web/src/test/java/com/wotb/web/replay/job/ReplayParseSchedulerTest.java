package com.wotb.web.replay.job;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

        assertTrue(scheduler.cancelQueued("b"), "无活跃 source 时取消应直接释放");
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
        assertFalse(scheduler.cancelQueued("p"), "存在活跃 source 时 onComplete 仍会触发");
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
        assertEquals(0, scheduler.activeSources());
        assertEquals(0, scheduler.queuedSources());
        scheduler.close();
        scheduler.close(); // 幂等
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
