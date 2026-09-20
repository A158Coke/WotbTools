package com.wotb.web.replay.job;

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

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Replay Processing Job 权威状态投影（V23 + {@link ReplayJobAuthority} + 注册表 jdbc 模式）。
 *
 * <p>锁死的契约：</p>
 *
 * <ul>
 *   <li>Flyway 从零跑到最新（含 V23）后三张权威表存在，且既有业务表未被破坏；</li>
 *   <li>一次 {@code save} 是原子的：job 行与 source 投影要么一起提交，要么一起回滚；</li>
 *   <li>陈旧快照（revision 更小）不得覆盖已提交的新状态，且不得改写 source 行；</li>
 *   <li>权威模式下持久化失败 fail closed：创建失败、迁移失败、终态不得被报告为已持久化；</li>
 *   <li>operationId 幂等由 PostgreSQL 裁决：重启后先识别已提交 identity，跨实例并发只产生
 *       一个权威 jobId；</li>
 *   <li>TTL 只回收「终态且已过期」的投影；内存模式完全不受权威状态与数据库故障影响。</li>
 * </ul>
 */
@Testcontainers(disabledWithoutDocker = true)
class ReplayJobAuthorityPostgresTest {

    private static final String SUBJECT = "user-1";
    private static final String OPERATION = "op-1";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    private static JdbcClient jdbc;
    private static PlatformTransactionManager transactions;

    @TempDir
    Path tempDir;

    @BeforeEach
    void migrateOnceThenCleanAuthorityTables() {
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
        // source / operation 由外键 cascade 删除，一条 delete 即可复位。
        jdbc.sql("delete from replay_processing_job").update();
    }

    @AfterEach
    void dropInjectedFailureTriggers() {
        if (jdbc == null) {
            return;
        }
        jdbc.sql("drop trigger if exists wotb_test_fail_job_insert on replay_processing_job").update();
        jdbc.sql("drop function if exists wotb_test_fail_job_insert()").update();
        jdbc.sql("drop trigger if exists wotb_test_fail_source_insert on replay_processing_source").update();
        jdbc.sql("drop function if exists wotb_test_fail_source_insert()").update();
    }

    @Test
    void fromScratchMigrationCreatesAuthorityTablesWithoutBreakingBusinessSchema() {
        assertTrue(tableExists("replay_processing_job"));
        assertTrue(tableExists("replay_processing_source"));
        assertTrue(tableExists("replay_processing_operation"));
        // V23 不得破坏 Flyway 链：既有业务表仍在（hall_of_fame_record 是数据移交的目标表）。
        assertTrue(tableExists("hall_of_fame_record"));
        assertTrue(tableExists("user_profile"));
    }

    @Test
    void saveAndFindRoundTripPreservesJobAndSourceState() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJob job =
                new ReplayProcessingJob("p-1", List.of("a.wotbreplay", "b.wotbreplay"));
        job.startProcessing();
        job.markSourceProcessing(0, "a.wotbreplay");
        authority.save(job.persistenceSnapshot());

        final ReplayJobAuthority.StoredJob stored = authority.findJob("p-1").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.PROCESSING, stored.status());
        assertEquals(ReplayProcessingJob.PHASE_PROCESSING_REPLAYS, stored.phase());
        assertEquals(2, stored.total());
        assertEquals(2, stored.sources().size());
        assertEquals(ReplayProcessingJob.SourceStatus.PROCESSING, stored.sources().get(0).status());
        assertEquals("r0", stored.sources().get(0).sourceId());
        assertEquals("a.wotbreplay", stored.sources().get(0).sourceName());
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING, stored.sources().get(1).status());
        assertTrue(stored.createdAtMillis() > 0);
        assertEquals(0L, stored.finishedAtMillis());
        assertEquals(job.revision(), stored.revision());
    }

    @Test
    void repeatedSaveOverwritesProgressCountersAndTerminalState() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJob job = new ReplayProcessingJob("p-2", List.of("a.wotbreplay"));
        job.startProcessing();
        authority.save(job.persistenceSnapshot());

        job.markSourceReady(0);
        job.recordParseSuccess();
        job.markFailed("REPLAY_UNREADABLE");
        authority.save(job.persistenceSnapshot());

        final ReplayJobAuthority.StoredJob stored = authority.findJob("p-2").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.FAILED, stored.status());
        assertEquals("REPLAY_UNREADABLE", stored.errorCode());
        assertEquals(1, stored.parseCompleted());
        assertEquals(1, stored.parseSucceeded());
        assertEquals(0, stored.parseFailed());
        assertEquals(1, stored.processed());
        assertTrue(stored.finishedAtMillis() > 0);
        assertEquals(ReplayProcessingJob.SourceStatus.READY, stored.sources().get(0).status());
    }

    @Test
    void saveRollsBackWholeProjectionWhenSourcePersistenceFails() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJob job =
                new ReplayProcessingJob("p-rollback", List.of("a.wotbreplay", "b.wotbreplay"));
        job.startProcessing();
        authority.save(job.persistenceSnapshot());
        assertEquals(1L, revisionOf("p-rollback"));

        injectSourceInsertFailure();
        job.markSourceReady(0);
        assertThrows(RuntimeException.class, () -> authority.save(job.persistenceSnapshot()));

        // 整个 save 回滚：job 行仍是上一次已提交的投影，source 行也没有被删/半量插入。
        final ReplayJobAuthority.StoredJob stored = authority.findJob("p-rollback").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.PROCESSING, stored.status());
        assertEquals(1L, stored.revision());
        assertEquals(2, stored.sources().size());
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING, stored.sources().get(0).status());
        assertEquals(1L, revisionOf("p-rollback"));
        assertEquals(2, countSources("p-rollback"));
    }

    @Test
    void staleSnapshotCannotOverwriteNewerCommittedProjection() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJob advanced = new ReplayProcessingJob("p-stale", List.of("a.wotbreplay"));
        advanced.startProcessing();
        advanced.markSourceReady(0);
        authority.save(advanced.persistenceSnapshot());

        // 陈旧快照：同一 jobId、revision 更小、状态更旧（PENDING 而不是 READY）。
        final ReplayProcessingJob stale = new ReplayProcessingJob("p-stale", List.of("a.wotbreplay"));
        authority.save(stale.persistenceSnapshot());

        final ReplayJobAuthority.StoredJob stored = authority.findJob("p-stale").orElseThrow();
        assertEquals(ReplayProcessingJob.Status.PROCESSING, stored.status());
        assertEquals(advanced.revision(), stored.revision());
        assertEquals(ReplayProcessingJob.SourceStatus.READY, stored.sources().get(0).status());
    }

    @Test
    void initialRegisterPersistFailureFailsCreateAndLeavesNoAuthorityRow() {
        injectJobInsertFailure();
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJobStore store = store(tempDir.resolve("register"), authority);
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob("p-init", List.of("a.wotbreplay"));
            assertThrows(RuntimeException.class, () -> store.register(job));
            assertNull(store.get("p-init"), "创建失败后内存视图不得残留 job");
            assertTrue(authority.findJob("p-init").isEmpty(), "创建失败后不得留下权威行");
        } finally {
            store.close();
        }
    }

    @Test
    void transitionPersistFailureFailsClosedAndDoesNotReportDurableState() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJobStore store = store(tempDir.resolve("transition"), authority);
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob("p-transition", List.of("a.wotbreplay"));
            store.register(job);

            injectSourceInsertFailure();
            assertThrows(RuntimeException.class, job::startProcessing);

            // 迁移没有被当作成功：可观测状态仍是数据库提交过的 QUEUED（不是 PROCESSING）。
            assertEquals(ReplayProcessingJob.Status.QUEUED, store.get("p-transition").snapshot().status());
            assertEquals("QUEUED", jdbc.sql("select status from replay_processing_job where job_id = :id")
                    .param("id", "p-transition").query(String.class).single());
            assertEquals(0L, revisionOf("p-transition"));
        } finally {
            store.close();
        }
    }

    @Test
    void terminalPersistFailureIsNotReportedAsDurable() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJobStore store = store(tempDir.resolve("terminal"), authority);
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob("p-terminal", List.of("a.wotbreplay"));
            store.register(job);
            assertTrue(job.startProcessing());

            injectSourceInsertFailure();
            assertThrows(RuntimeException.class, () -> job.markFailed("INJECTED_FAILURE"));

            // 终态没写成 → 绝不对外声称 FAILED；权威状态仍是已提交的 PROCESSING。
            assertEquals(ReplayProcessingJob.Status.PROCESSING,
                    store.get("p-terminal").snapshot().status());
            assertEquals("PROCESSING", jdbc.sql("select status from replay_processing_job where job_id = :id")
                    .param("id", "p-terminal").query(String.class).single());
            assertEquals(0, jdbc.sql("select count(*) from replay_processing_job "
                            + "where job_id = :id and error_code is not null")
                    .param("id", "p-terminal").query(Integer.class).single());
        } finally {
            store.close();
        }
    }

    @Test
    void memoryModeIsUnaffectedByAuthorityFailureAndWritesNothing() {
        // job 表 INSERT 被注入失败：内存模式不得触碰权威状态，因此必须完全不受影响。
        injectJobInsertFailure();
        final ReplayProcessingJobStore memory = store(tempDir.resolve("memory"), null);
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob("p-memory", List.of("a.wotbreplay"));
            memory.register(job);
            assertTrue(job.startProcessing());
            assertTrue(job.markFailed("MEMORY_MODE"));
            assertEquals("p-memory", memory.get("p-memory").jobId());
            assertEquals(0, jdbc.sql("select count(*) from replay_processing_job")
                    .query(Integer.class).single());
        } finally {
            memory.close();
        }
    }

    @Test
    void commitOperationIsIdempotentAndScopedBySubject() {
        final ReplayJobAuthority authority = authority();
        authority.save(new ReplayProcessingJob("p-3", List.of("a.wotbreplay")).persistenceSnapshot());

        assertTrue(authority.commitOperation(SUBJECT, OPERATION, "p-3"));
        assertFalse(authority.commitOperation(SUBJECT, OPERATION, "p-3"),
                "同一 identity 只允许一次 COMMITTED");
        assertEquals("p-3", authority.findCommittedJobId(SUBJECT, OPERATION));
        assertNull(authority.findCommittedJobId("user-2", OPERATION),
                "operationId 必须按 authenticated subject 分域");
    }

    @Test
    void committedIndexDisappearsWhenJobIsCleaned() {
        final ReplayJobAuthority authority = authority();
        authority.save(new ReplayProcessingJob("p-4", List.of("a.wotbreplay")).persistenceSnapshot());
        authority.commitOperation(SUBJECT, OPERATION, "p-4");

        authority.deleteJob("p-4");

        assertTrue(authority.findJob("p-4").isEmpty());
        assertTrue(authority.listJobIds().isEmpty());
        assertNull(authority.findCommittedJobId(SUBJECT, OPERATION),
                "job 已清理后同一 operationId 必须可重新创建");
        assertEquals(0, jdbc.sql("select count(*) from replay_processing_source")
                .query(Integer.class).single());
        assertEquals(0, jdbc.sql("select count(*) from replay_processing_operation")
                .query(Integer.class).single());
    }

    @Test
    void claimOperationReturnsCommittedIdentityAfterRestartInsteadOfBecomingCreator() {
        final ReplayProcessingJobStore first = store(tempDir.resolve("first"), authority());
        final String jobId = "p-restart";
        try {
            first.register(new ReplayProcessingJob(jobId, List.of("a.wotbreplay")));
            first.commitOperation(SUBJECT, OPERATION, CompletableFuture.completedFuture(jobId), jobId);
        } finally {
            first.close();
        }

        // 新进程：第一个动作就是 claim，必须在成为 creator 之前识别出已提交 identity。
        final ReplayProcessingJobStore restarted = store(tempDir.resolve("restarted"), authority());
        try {
            final ReplayProcessingJobStore.OperationClaim claim =
                    restarted.claimOperation(SUBJECT, OPERATION, new CompletableFuture<>());
            assertEquals(ReplayProcessingJobStore.OperationClaim.Kind.COMMITTED, claim.kind());
            assertEquals(jobId, claim.jobId());
            assertEquals(jobId, restarted.jobIdForOperation(SUBJECT, OPERATION));
            assertNull(restarted.jobIdForOperation("user-2", OPERATION));
        } finally {
            restarted.close();
        }
    }

    @Test
    void concurrentCreatorsAcrossIndependentStoresCommitExactlyOneIdentity() throws Exception {
        final ReplayJobAuthority authorityA = authority();
        final ReplayJobAuthority authorityB = authority();
        final ReplayProcessingJobStore storeA = store(tempDir.resolve("race-a"), authorityA);
        final ReplayProcessingJobStore storeB = store(tempDir.resolve("race-b"), authorityB);
        final CyclicBarrier barrier = new CyclicBarrier(2);
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            final Future<String> first = pool.submit(() -> claimAndCommit(storeA, barrier));
            final Future<String> second = pool.submit(() -> claimAndCommit(storeB, barrier));

            final String idA = first.get(30, TimeUnit.SECONDS);
            final String idB = second.get(30, TimeUnit.SECONDS);

            assertEquals(idA, idB, "同一 identity 的两个并发 creator 必须收敛到同一个权威 jobId");
            assertEquals(idA, authorityA.findCommittedJobId(SUBJECT, OPERATION));
            assertEquals(1, jdbc.sql("select count(*) from replay_processing_operation "
                            + "where owner_subject = :subject and operation_id = :operation")
                    .param("subject", SUBJECT).param("operation", OPERATION)
                    .query(Integer.class).single(), "同一 identity 只允许一行 COMMITTED");
        } finally {
            storeA.close();
            storeB.close();
        }
    }

    @Test
    void operationIdIdempotencySurvivesStoreRestart() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJobStore first = store(tempDir.resolve("op-first"), authority);
        final String jobId = UUID.randomUUID().toString();
        try {
            first.register(new ReplayProcessingJob(jobId, List.of("a.wotbreplay")));
            first.commitOperation(SUBJECT, OPERATION, CompletableFuture.completedFuture(jobId), jobId);
        } finally {
            first.close();
        }

        final ReplayProcessingJobStore restarted = store(tempDir.resolve("op-restarted"), authority());
        try {
            assertEquals(jobId, restarted.jobIdForOperation(SUBJECT, OPERATION));
            assertNull(restarted.jobIdForOperation("user-2", OPERATION));
        } finally {
            restarted.close();
        }
    }

    @Test
    void newStoreInstanceRestoresStateAndKeepsRecoverableJobArtifacts() throws Exception {
        final ReplayJobAuthority authority = authority();

        final ReplayProcessingJobStore first = store(tempDir.resolve("restore"), authority);
        final String jobId = "p-5";
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob(jobId, List.of("a.wotbreplay"));
            first.register(job);
            job.startProcessing();
            job.markSourceReady(0);
            job.recordParseSuccess();
        } finally {
            first.close();
        }
        final Path uploadedInput = first.inputDir(jobId).resolve("0__a.wotbreplay");
        Files.createDirectories(uploadedInput.getParent());
        Files.writeString(uploadedInput, "bytes");

        final ReplayProcessingJobStore restarted = store(tempDir.resolve("restore"), authority());
        try {
            final ReplayProcessingJob restored = restarted.get(jobId);
            assertNotNull(restored, "重启后必须仍能读取权威状态");
            final ReplayProcessingJob.Snapshot snapshot = restored.snapshot();
            assertEquals(ReplayProcessingJob.Status.PROCESSING, snapshot.status());
            assertEquals(ReplayProcessingJob.PHASE_PROCESSING_REPLAYS, snapshot.phase());
            assertEquals(1, snapshot.parseSucceeded());
            assertEquals(1, snapshot.processed());
            assertEquals(ReplayProcessingJob.SourceStatus.READY, snapshot.sources().get(0).status());
            assertTrue(snapshot.activeSources().isEmpty());
            // 恢复的 job 没有执行上下文：不参与 Dataset 消费（result 恒为 null）。
            assertNull(restored.result());
            // 孤儿清理必须用权威 job 集合：可恢复 job 的本地输入不得被删掉。
            assertTrue(Files.exists(uploadedInput),
                    "权威模式下启动孤儿清理不得删除可恢复 job 的本地产物");
        } finally {
            restarted.close();
        }
    }

    @Test
    void deleteExpiredTerminalRemovesOnlyExpiredTerminalJobs() {
        final ReplayJobAuthority authority = authority();
        final long now = System.currentTimeMillis();
        final long cutoff = now - 60 * 60 * 1000L;

        insertJob("old-ready", "READY", now - 61 * 60 * 1000L);
        insertJob("fresh-ready", "READY", now - 10 * 60 * 1000L);
        insertJob("old-failed", "FAILED", now - 90 * 60 * 1000L);
        insertJob("old-processing", "PROCESSING", 0L);
        insertJob("old-queued", "QUEUED", 0L);

        assertEquals(2, authority.deleteExpiredTerminal(cutoff));
        assertEquals(List.of("fresh-ready", "old-processing", "old-queued"),
                authority.listJobIds().stream().sorted().toList());
    }

    @Test
    void capturedPersistenceSnapshotIsImmutableAndBoundToOneRevision() {
        final ReplayProcessingJob job =
                new ReplayProcessingJob("p-capture", List.of("a.wotbreplay", "b.wotbreplay"));
        job.startProcessing();
        final ReplayJobPersistenceSnapshot before = job.persistenceSnapshot();

        job.markSourceReady(0);
        job.recordParseSuccess();
        job.markFailed("LATER");
        final ReplayJobPersistenceSnapshot after = job.persistenceSnapshot();

        // 已捕获的快照不可变：后续迁移既不改它的版本号，也不改它的状态
        assertEquals(1L, before.revision());
        assertEquals(ReplayProcessingJob.Status.PROCESSING, before.status());
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING, before.sources().get(0).status());
        assertEquals(0, before.parseSucceeded());
        assertEquals(2, before.sources().size());

        assertEquals(ReplayProcessingJob.Status.FAILED, after.status());
        assertEquals(ReplayProcessingJob.SourceStatus.READY, after.sources().get(0).status());
        assertEquals(1, after.parseSucceeded());
        assertTrue(after.revision() > before.revision(), "每次迁移必须取到互不相同的 revision");
        assertThrows(UnsupportedOperationException.class,
                () -> after.sources().add(before.sources().get(0)),
                "快照里的 source 列表必须是不可变副本");
    }

    @Test
    void laterTransitionWinsEvenWhenEarlierSnapshotIsPersistedAfterwards() {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJob job = new ReplayProcessingJob("p-order", List.of("a.wotbreplay"));

        job.startProcessing();
        final ReplayJobPersistenceSnapshot transitionA = job.persistenceSnapshot();

        job.markSourceReady(0);
        job.recordParseSuccess();
        job.markFailed("B_WINS");
        final ReplayJobPersistenceSnapshot transitionB = job.persistenceSnapshot();
        authority.save(transitionB);

        // 迁移 A 的快照晚到：必须被整体拒绝，不得用旧状态冒充已经提交的新版本
        authority.save(transitionA);

        assertEquals(1L, transitionA.revision(), "快照不可变：后发生的迁移不得改变 A 的版本号");
        assertEquals(ReplayProcessingJob.Status.PROCESSING, transitionA.status());
        final ReplayJobAuthority.StoredJob stored = authority.findJob("p-order").orElseThrow();
        assertEquals(transitionB.revision(), stored.revision());
        assertEquals(ReplayProcessingJob.Status.FAILED, stored.status());
        assertEquals("B_WINS", stored.errorCode());
        assertEquals(1, stored.parseSucceeded());
        assertEquals(transitionB.sources(), stored.sources());
    }

    @Test
    void concurrentTransitionsOnOneLiveJobConvergeToTheNewestRevision() throws Exception {
        final ReplayJobAuthority authority = authority();
        final ReplayProcessingJobStore store = store(tempDir.resolve("concurrent"), authority);
        final String jobId = "p-concurrent";
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob(jobId, List.of("a.wotbreplay"));
            store.register(job);
            assertTrue(job.startProcessing());

            try (ExecutorService pool = Executors.newFixedThreadPool(4)) {
                final List<Future<?>> futures = new ArrayList<>();
                for (int worker = 0; worker < 4; worker++) {
                    final int seed = worker;
                    futures.add(pool.submit(() -> {
                        for (int i = 0; i < 25; i++) {
                            final int step = seed * 25 + i;
                            job.updateProgress(step, 0, 0);
                            if (step % 2 == 0) {
                                job.markSourceReady(0);
                                job.recordParseSuccess();
                            } else {
                                job.markSourceFailed(0, "e" + step);
                                job.recordParseFailure();
                            }
                        }
                    }));
                }
                for (final Future<?> future : futures) {
                    future.get(60, TimeUnit.SECONDS);
                }
            }

            // 所有并发迁移都返回后，权威投影必须恰好等于最新一次迁移的快照
            final ReplayJobPersistenceSnapshot live = job.persistenceSnapshot();
            final ReplayJobAuthority.StoredJob stored = authority.findJob(jobId).orElseThrow();
            assertEquals(live.revision(), stored.revision(), "权威投影必须停在最新 revision");
            assertEquals(live.status(), stored.status());
            assertEquals(live.phase(), stored.phase());
            assertEquals(live.processed(), stored.processed());
            assertEquals(live.parseSucceeded(), stored.parseSucceeded());
            assertEquals(live.parseFailed(), stored.parseFailed());
            assertEquals(live.sources(), stored.sources());
        } finally {
            store.close();
        }
    }

    private String claimAndCommit(final ReplayProcessingJobStore store, final CyclicBarrier barrier) {
        final CompletableFuture<String> mine = new CompletableFuture<>();
        final ReplayProcessingJobStore.OperationClaim claim =
                store.claimOperation(SUBJECT, OPERATION, mine);
        if (claim.kind() == ReplayProcessingJobStore.OperationClaim.Kind.COMMITTED) {
            return claim.jobId();
        }
        if (claim.kind() == ReplayProcessingJobStore.OperationClaim.Kind.JOIN) {
            return awaitQuietly(claim.inFlight());
        }
        final String jobId = UUID.randomUUID().toString();
        store.register(new ReplayProcessingJob(jobId, List.of("a.wotbreplay")));
        awaitBarrier(barrier);
        final String authoritative = store.commitOperation(SUBJECT, OPERATION, mine, jobId);
        mine.complete(authoritative);
        return authoritative;
    }

    /**
     * 等待另一个 creator 走到同一点。对端若走了 COMMITTED/JOIN 分支就不会到达这里，
     * 此时 barrier 超时属预期（不影响断言：唯一性由 PostgreSQL 保证），因此吞掉超时。
     */
    private static void awaitBarrier(final CyclicBarrier barrier) {
        try {
            barrier.await(2, TimeUnit.SECONDS);
        } catch (final TimeoutException | BrokenBarrierException ignored) {
            // 对端未到达：继续执行，唯一性断言仍成立。
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("BARRIER_INTERRUPTED", e);
        }
    }

    private static String awaitQuietly(final CompletableFuture<String> inFlight) {
        try {
            return inFlight.get(30, TimeUnit.SECONDS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("JOIN_INTERRUPTED", e);
        } catch (final Exception e) {
            throw new IllegalStateException("JOIN_FAILED", e);
        }
    }

    private void injectJobInsertFailure() {
        jdbc.sql("create or replace function wotb_test_fail_job_insert() returns trigger "
                + "language plpgsql as $$ begin raise exception 'injected job insert failure'; end $$").update();
        jdbc.sql("create trigger wotb_test_fail_job_insert before insert on replay_processing_job "
                + "for each row execute function wotb_test_fail_job_insert()").update();
    }

    private void injectSourceInsertFailure() {
        jdbc.sql("create or replace function wotb_test_fail_source_insert() returns trigger "
                + "language plpgsql as $$ begin raise exception 'injected source insert failure'; end $$").update();
        jdbc.sql("create trigger wotb_test_fail_source_insert before insert on replay_processing_source "
                + "for each row execute function wotb_test_fail_source_insert()").update();
    }

    private static ReplayJobAuthority authority() {
        return new ReplayJobAuthority(jdbc, transactions);
    }

    private static ReplayProcessingJobStore store(final Path dir, final ReplayJobAuthority authority) {
        return new ReplayProcessingJobStore(dir, 60, authority);
    }

    private static long revisionOf(final String jobId) {
        return jdbc.sql("select revision from replay_processing_job where job_id = :id")
                .param("id", jobId).query(Long.class).single();
    }

    private static int countSources(final String jobId) {
        return jdbc.sql("select count(*) from replay_processing_source where job_id = :id")
                .param("id", jobId).query(Integer.class).single();
    }

    private void insertJob(final String jobId, final String status, final long finishedAtMillis) {
        final long createdAtMillis = finishedAtMillis > 0 ? finishedAtMillis : 1L;
        jdbc.sql("""
                        insert into replay_processing_job (
                            job_id, status, total, created_at, finished_at)
                        values (:jobId, :status, 1, :createdAt, :finishedAt)
                        """)
                .param("jobId", jobId)
                .param("status", status)
                .param("createdAt", utc(createdAtMillis), Types.TIMESTAMP_WITH_TIMEZONE)
                .param("finishedAt", finishedAtMillis > 0 ? utc(finishedAtMillis) : null,
                        Types.TIMESTAMP_WITH_TIMEZONE)
                .update();
    }

    private static OffsetDateTime utc(final long epochMillis) {
        return OffsetDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ZoneOffset.UTC);
    }

    private static boolean tableExists(final String tableName) {
        return jdbc.sql("select count(*) from information_schema.tables "
                        + "where table_schema = 'public' and table_name = :tableName")
                .param("tableName", tableName)
                .query(Integer.class)
                .single() > 0;
    }
}
