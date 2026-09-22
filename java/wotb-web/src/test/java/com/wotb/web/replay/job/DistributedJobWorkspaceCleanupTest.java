package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.storage.ObjectStorageKeys;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.spy;

/**
 * TTL 过期回收的**跨存储顺序与失败恢复**（真实 PostgreSQL + {@link ObjectStorage} 替身）。
 *
 * <p>不变式：MinIO 是 dataset / artifact 权威，因此过期回收必须同时回收对象存储工作区，且顺序是
 * <b>先 MinIO、后 PostgreSQL</b>——反过来「PG 先删、MinIO 失败」会留下再也没人知道该删的孤儿对象。
 * 桶上的 1 天 lifecycle 只是兜底，不是正常回收机制。</p>
 */
@Testcontainers(disabledWithoutDocker = true)
class DistributedJobWorkspaceCleanupTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    private static JdbcClient jdbc;
    private static PlatformTransactionManager transactions;

    @TempDir
    Path tempDir;

    private ToggleableStorage storage;
    private ReplayProcessingJobStore store;
    private String jobId;

    @BeforeEach
    void setUp() {
        if (jdbc == null) {
            Flyway.configure()
                    .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();
            final DriverManagerDataSource dataSource = new DriverManagerDataSource(
                    POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
            jdbc = JdbcClient.create(dataSource);
            transactions = new DataSourceTransactionManager(dataSource);
        }
        jdbc.sql("delete from replay_processing_job").update();
        storage = new ToggleableStorage();
        jobId = "cleanup-" + UUID.randomUUID();
        // ttl = -1 分钟 ⇒ cutoff 在“现在”之后：登记后立刻视为过期，无需等待真实 TTL。
        store = newStore(authority(), storage);
    }

    @AfterEach
    void closeStore() {
        store.close();
    }

    /** 过期终态 + 无 lease：MinIO 工作区与 PG 行都被回收。 */
    @Test
    void expiredTerminalJobReclaimsBothObjectStorageWorkspaceAndAuthorityRow() {
        readyJob();
        assertFalse(storage.objects.isEmpty(), "前置条件：对象存储里确实有工作区对象");

        store.sweepExpired();

        assertTrue(storage.objects.isEmpty(),
                "过期回收必须删除 temp/jobs/<jobId>/ 下的全部对象: " + storage.objects.keySet());
        assertTrue(authority().findJob(jobId).isEmpty(), "对象存储回收成功后必须删除权威行");
    }

    /** 活跃 Dataset Lease：两侧都不得动。 */
    @Test
    void activeDatasetLeaseKeepsBothObjectStorageAndAuthorityIntact() {
        readyJob();
        assertNotNull(store.acquireForSource(jobId), "lease 必须成功获取");
        final int objectsBefore = storage.objects.size();

        store.sweepExpired();

        assertEquals(objectsBefore, storage.objects.size(), "lease 期间不得删除对象存储工作区");
        assertTrue(authority().findJob(jobId).isPresent(), "lease 期间不得删除权威行");
    }

    /** MinIO 回收失败：**PG 必须保留**（绝不先删权威身份），下一轮重试。 */
    @Test
    void objectStorageFailureKeepsAuthorityRowAndRetriesOnNextSweep() {
        readyJob();
        storage.failDeletes = true;

        store.sweepExpired();

        assertTrue(authority().findJob(jobId).isPresent(),
                "对象存储回收失败时必须保留权威行（否则对象成为再也没人知道的孤儿）");
        assertFalse(storage.objects.isEmpty(), "失败时对象当然还在");

        // 存储恢复后：下一轮 sweep 完成回收。
        storage.failDeletes = false;
        store.sweepExpired();

        assertTrue(storage.objects.isEmpty(), "恢复后必须清空工作区");
        assertTrue(authority().findJob(jobId).isEmpty(), "恢复后必须回收权威行");
    }

    /** 工作区本来就不存在（已删过 / 从未写过）：幂等成功，照样回收权威行。 */
    @Test
    void missingWorkspaceIsIdempotentAndStillReclaimsAuthorityRow() {
        readyJob();
        storage.objects.clear();

        store.sweepExpired();

        assertTrue(authority().findJob(jobId).isEmpty(), "空工作区必须视为已回收");
    }

    /**
     * MinIO 成功 + PG 删除失败：权威行留着，下一轮会重复一次**无害**的 MinIO 回收，
     * 然后正常删行——这条路径正是「顺序先 MinIO」换来的可恢复性。
     */
    @Test
    void authorityDeleteFailureIsRecoverableByRepeatingTheIdempotentWorkspaceCleanup() {
        readyJob();
        final ReplayJobAuthority failing = spy(authority());
        doThrow(new IllegalStateException("authority unavailable")).when(failing).deleteJob(jobId);
        final ReplayProcessingJobStore failingStore = newStore(failing, storage);

        try {
            failingStore.sweepExpired();

            assertTrue(storage.objects.isEmpty(), "对象存储工作区已回收");
            assertTrue(authority().findJob(jobId).isPresent(), "PG 删除失败时权威行仍在");
        } finally {
            failingStore.close();
        }

        // 恢复后重跑：MinIO 回收幂等（已空），权威行被删。
        store.sweepExpired();
        assertTrue(authority().findJob(jobId).isEmpty(), "下一轮 sweep 必须完成回收");
    }

    /**
     * 并发 race：sweeper 已做出清理决定、正准备删 MinIO 时，并发的 `acquireForSource` 只能有一种结果。
     *
     * <p>允许的结果：要么 acquire 先线性化（lease &gt; 0 ⇒ sweeper 跳过），要么 sweep 先领取回收权
     * （新 acquire 直接失败）。**绝不允许**「acquire 成功拿到 lease，随后工作区/权威行被删」。</p>
     *
     * <p>本测试把存储删除卡在 latch 上，制造出「PG 行仍在、尚未删任何对象」的精确窗口：此时 acquire
     * 若还能成功，就说明它拿到的是一个马上会被删掉的 job。</p>
     */
    @Test
    void concurrentAcquireIsRejectedWhileASweepHasClaimedTheJobForReclaim() throws Exception {
        readyJob();
        final CountDownLatch cleanupStarted = new CountDownLatch(1);
        final CountDownLatch cleanupMayFinish = new CountDownLatch(1);
        storage.beforeDelete = () -> {
            cleanupStarted.countDown();
            awaitQuietly(cleanupMayFinish);
        };

        final Thread sweeper = new Thread(store::sweepExpired, "race-sweeper");
        sweeper.start();
        try {
            assertTrue(cleanupStarted.await(10, TimeUnit.SECONDS),
                    "sweeper 必须先进入对象存储回收（否则本测试没有制造出 race 窗口）");
            // 窗口内：PG 行仍在（删除还没发生），但回收权已被 sweep 领取。
            assertTrue(authority().findJob(jobId).isPresent(), "清理尚未完成，权威行理应仍在");
            assertNull(store.acquireForSource(jobId),
                    "sweep 已 claim 回收权 ⇒ acquire 必须失败，绝不能拿到一个随后被删的 job");
            assertNull(store.acquireForExport(jobId), "Export 的 acquire 同样必须被挡住");
        } finally {
            cleanupMayFinish.countDown();
            sweeper.join(TimeUnit.SECONDS.toMillis(10));
        }

        assertTrue(storage.objects.isEmpty(), "claim 之后清理照常完成");
        assertTrue(authority().findJob(jobId).isEmpty(), "claim 之后权威行照常回收");
        // claim 释放后（job 已不存在）acquire 仍必须安全失败。
        assertNull(store.acquireForSource(jobId));
    }

    /** latch 等待期间的自我中断语义：测试线程不掩盖中断。 */
    private static void awaitQuietly(final CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ---- fixtures ----

    private ReplayProcessingJobStore newStore(final ReplayJobAuthority authority, final ObjectStorage objectStorage) {
        return new ReplayProcessingJobStore(tempDir.resolve("store-" + UUID.randomUUID()), -1, authority,
                new ObjectStorageReplayJobWorkspaceCleaner(objectStorage));
    }

    private ReplayJobAuthority authority() {
        return new PostgresReplayJobAuthority(jdbc, transactions);
    }

    /** 登记一个 READY 终态 job，并把它的完整对象存储工作区写出来。 */
    private void readyJob() {
        final ReplayProcessingJob job = new ReplayProcessingJob(jobId, List.of("a.wotbreplay", "b.wotbreplay"));
        store.register(job);
        job.startProcessing();
        job.markSourceReady(0);
        job.markSourceReady(1);
        job.recordParseSuccess();
        job.recordParseSuccess();
        job.markReady();

        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            final int index = source.sourceIndex();
            put("input/" + index + "/" + source.sourceName());
            put("result/source-" + index + ".json");
            put("artifacts/" + index + "/" + ReplayArtifactWriter.AI_FACTS_NAME);
            put("artifacts/" + index + "/" + ReplayArtifactWriter.MAP_OVERVIEW_NAME);
            put("artifacts/" + index + "/" + ReplayArtifactWriter.BATTLE_PLAYBACK_V2_NAME);
        }
        put("result/finalized.json");
    }

    private void put(final String relativePath) {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, relativePath);
        storage.objects.put(key.value(), relativePath.getBytes(StandardCharsets.UTF_8));
    }

    /** 可切换删除失败的 {@link ObjectStorage} 替身（真实 adapter 覆盖在 `MinioObjectStorageTest`）。 */
    private static final class ToggleableStorage implements ObjectStorage {

        private final Map<String, byte[]> objects = new LinkedHashMap<>();
        private boolean failDeletes;
        /** 每次 delete 之前调用（用于把清理卡在确定的位置，制造 race 窗口）。 */
        private Runnable beforeDelete = () -> { };

        @Override
        public void put(final ObjectKey key, final InputStream content, final long contentLength,
                        final String contentType) throws IOException {
            objects.put(key.value(), content.readAllBytes());
        }

        @Override
        public InputStream get(final ObjectKey key) {
            final byte[] body = objects.get(key.value());
            return body == null ? new ByteArrayInputStream(new byte[0]) : new ByteArrayInputStream(body);
        }

        @Override
        public boolean exists(final ObjectKey key) {
            return objects.containsKey(key.value());
        }

        @Override
        public void delete(final ObjectKey key) throws IOException {
            beforeDelete.run();
            if (failDeletes) {
                throw new IOException("simulated object storage outage");
            }
            objects.remove(key.value());
        }
    }
}
