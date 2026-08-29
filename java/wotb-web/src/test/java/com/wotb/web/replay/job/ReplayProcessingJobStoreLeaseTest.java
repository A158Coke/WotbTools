package com.wotb.web.replay.job;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Dataset Lease 与 TTL cleanup 的 lifecycle atomicity（线性化）确定性测试。
 *
 * <p>不依赖 sleep：过期状态通过反射回拨 finishedAtMillis 确定构造；acquire 先成功 /
 * sweep 先成功两种 linearization 都以确定顺序驱动。invariant：
 * 「成功 acquire lease 后 TTL cleanup 不得删除正在消费的 Dataset」、
 * 「sweep/remove 先移除后 acquire 必须失败（绝不返回已删除 job）」。
 */
class ReplayProcessingJobStoreLeaseTest {

    private ReplayProcessingJobStore store;
    private Path root;

    @AfterEach
    void tearDown() {
        if (store != null) {
            store.close();
        }
    }

    private ReplayProcessingJobStore newStore() throws Exception {
        root = Files.createTempDirectory("wotb-store-lease-test");
        store = new ReplayProcessingJobStore(root, 1);
        return store;
    }

    private static ReplayProcessingJob readyJob(final String id) {
        final ReplayProcessingJob job = new ReplayProcessingJob(id, 1);
        job.startProcessing();
        job.updateProgress(1, 0, 0);
        job.markReady(new ProcessedDataset(
                List.of(), List.of(), List.<String[]>of(), List.<String[]>of(), null, null));
        return job;
    }

    /** 回拨 finishedAtMillis 到 TTL 之前（反射，测试专用），让 job 确定性「已过期」。 */
    private static void backdate(final ReplayProcessingJob job, final long ageMillis) throws Exception {
        final Field stateField = ReplayProcessingJob.class.getDeclaredField("state");
        stateField.setAccessible(true);
        final Object state = stateField.get(job);
        final Field finishedField = state.getClass().getDeclaredField("finishedAtMillis");
        finishedField.setAccessible(true);
        finishedField.setLong(state, System.currentTimeMillis() - ageMillis);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, AtomicInteger> leaseRefs(final ReplayProcessingJobStore store) throws Exception {
        final Field refsField = ReplayProcessingJobStore.class.getDeclaredField("datasetLeaseRefs");
        refsField.setAccessible(true);
        return (Map<String, AtomicInteger>) refsField.get(store);
    }

    @Test
    void acquireForSourceWinsThenReleaseAllowsSweep() throws Exception {
        final ReplayProcessingJobStore s = newStore();
        final String id = "source-lease";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        backdate(job, TimeUnit.MINUTES.toMillis(3));

        assertNotNull(s.acquireForSource(id), "Dataset Lease acquire 应成功");

        // linearization 1：acquire 先成功 → sweeper 必须看见 lease，不得删除。
        s.sweepExpired();
        assertNotNull(s.get(id), "lease 期间 sweeper 不得移除 job");
        assertTrue(Files.exists(s.jobDir(id)), "lease 期间 storage 不得删除");

        // release 后下轮 sweep 才允许清理，且不残留 stale lease counter。
        s.release(id);
        s.sweepExpired();
        assertNull(s.get(id), "release 后下轮 sweep 应清理 job");
        assertFalse(Files.exists(s.jobDir(id)), "release 后 storage 应被清理");
        assertTrue(leaseRefs(s).isEmpty(), "cleanup 后不得残留 lease counter");
    }

    @Test
    void acquireForExportWinsThenReleaseAllowsSweep() throws Exception {
        final ReplayProcessingJobStore s = newStore();
        final String id = "export-lease";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        backdate(job, TimeUnit.MINUTES.toMillis(3));

        assertNotNull(s.acquireForExport(id), "Export acquire 应成功（READY + result 非空）");

        s.sweepExpired();
        assertNotNull(s.get(id), "Export lease 期间 sweeper 不得移除 job");
        assertTrue(Files.exists(s.jobDir(id)), "Export lease 期间 storage 不得删除");

        s.release(id);
        s.sweepExpired();
        assertNull(s.get(id));
        assertFalse(Files.exists(s.jobDir(id)));
        assertTrue(leaseRefs(s).isEmpty());
    }

    @Test
    void sweepWinsThenAcquireFailsCleanly() throws Exception {
        final ReplayProcessingJobStore s = newStore();
        final String id = "sweep-first";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        backdate(job, TimeUnit.MINUTES.toMillis(3));

        // linearization 2：sweep 先成功移除 → 之后任何 acquire 都必须失败（绝不返回已删除 job）。
        s.sweepExpired();
        assertNull(s.get(id), "sweep 应移除 job");
        assertFalse(Files.exists(s.jobDir(id)), "sweep 应删除 storage");

        assertNull(s.acquireForSource(id), "已清理 job 不得被 acquireForSource 返回");
        assertNull(s.acquireForExport(id), "已清理 job 不得被 acquireForExport 返回");
        assertTrue(leaseRefs(s).isEmpty(), "失败 acquire 不得产生 lease counter");
    }

    @Test
    void releaseExactlyOnceAndUnderflowSafe() throws Exception {
        final ReplayProcessingJobStore s = newStore();
        final String id = "multi-release";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        backdate(job, TimeUnit.MINUTES.toMillis(3));

        s.acquireForSource(id);
        s.acquireForSource(id);
        assertEquals(2, leaseRefs(s).get(id).intValue(), "两次 acquire = 两个 lease");

        // 释放一个 lease：sweep 仍必须跳过。
        s.release(id);
        s.sweepExpired();
        assertNotNull(s.get(id), "仍有 1 个 lease 时不得清理");

        // 释放最后一个：sweep 清理；多余 release 不得抛异常、不得产生负数。
        s.release(id);
        s.release(id);
        s.sweepExpired();
        assertNull(s.get(id));
        assertTrue(leaseRefs(s).isEmpty(), "release 不得留下负值或 stale counter");
    }

    @Test
    void concurrentMultipleLeasesBlockSweepUntilAllReleased() throws Exception {
        final ReplayProcessingJobStore s = newStore();
        final String id = "concurrent-lease";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        backdate(job, TimeUnit.MINUTES.toMillis(3));

        final ExecutorService pool = Executors.newFixedThreadPool(2);
        final CountDownLatch bothAcquired = new CountDownLatch(2);
        try {
            for (int i = 0; i < 2; i++) {
                pool.submit(() -> {
                    try {
                        assertNotNull(s.acquireForSource(id));
                    } finally {
                        bothAcquired.countDown();
                    }
                });
            }
            assertTrue(bothAcquired.await(5, TimeUnit.SECONDS), "两个并发 acquire 都应完成");

            s.sweepExpired();
            assertNotNull(s.get(id), "两个 lease 都存在时 sweep 必须跳过");

            s.release(id);
            s.release(id);
            s.sweepExpired();
            assertNull(s.get(id), "全部 release 后 sweep 才清理");
            assertFalse(Files.exists(s.jobDir(id)));
        } finally {
            pool.shutdownNow();
        }
        assertTrue(leaseRefs(s).isEmpty());
    }

    @Test
    void removeAndCleanupFollowsLifecycleProtocol() throws Exception {
        final ReplayProcessingJobStore s = newStore();
        final String id = "force-remove";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        s.acquireForSource(id);

        // 强制移除与 acquire 走同一 lifecycle 协议：registry 移除 + lease 清理后，
        // 后续 acquire 必须失败（不返回已删除 job）。
        s.removeAndCleanup(id);
        assertNull(s.get(id));
        assertFalse(Files.exists(s.jobDir(id)));
        assertTrue(leaseRefs(s).isEmpty(), "removeAndCleanup 必须清理 lease counter");
        assertNull(s.acquireForSource(id));
    }

    @Test
    void concurrentAcquireReleaseSweepNeverReturnsDeletedDataset() throws Exception {
        // 线性化 invariant 压力回归（无 sleep）：成功 acquire 的瞬间 storage 必须存在。
        final ReplayProcessingJobStore s = newStore();
        final String id = "stress";
        final ReplayProcessingJob job = readyJob(id);
        Files.createDirectories(s.jobDir(id));
        s.register(job);
        backdate(job, TimeUnit.MINUTES.toMillis(3));

        final int rounds = 200;
        final AtomicBoolean violation = new AtomicBoolean();
        final AtomicReference<Throwable> failure = new AtomicReference<>();
        final ExecutorService pool = Executors.newFixedThreadPool(4);
        final CountDownLatch start = new CountDownLatch(1);
        try {
            for (int t = 0; t < 3; t++) {
                pool.submit(() -> {
                    try {
                        start.await();
                        for (int i = 0; i < rounds; i++) {
                            final ReplayProcessingJob acquired = s.acquireForSource(id);
                            if (acquired != null) {
                                // lease 持有期间 sweeper 绝不可能删除 storage（线性化 invariant）。
                                if (!Files.exists(s.jobDir(id))) {
                                    violation.set(true);
                                }
                                s.release(id);
                            }
                        }
                    } catch (final Throwable e) {
                        failure.set(e);
                    }
                });
            }
            pool.submit(() -> {
                try {
                    start.await();
                    for (int i = 0; i < rounds; i++) {
                        s.sweepExpired();
                    }
                } catch (final Throwable e) {
                    failure.set(e);
                }
            });
            start.countDown();
            pool.shutdown();
            assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS), "并发压力测试应完成");
        } finally {
            pool.shutdownNow();
        }
        assertNull(failure.get(), "并发执行不得抛异常");
        assertFalse(violation.get(), "成功 acquire 后 storage 绝不能被删除");
    }
}
