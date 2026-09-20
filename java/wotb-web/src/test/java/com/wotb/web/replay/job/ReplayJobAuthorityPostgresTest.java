package com.wotb.web.replay.job;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Replay Processing Job 权威状态投影（V23 + {@link ReplayJobAuthority} + 注册表 jdbc 模式）。
 *
 * <p>锁死的契约：</p>
 *
 * <ul>
 *   <li>Flyway 从零跑到最新（含 V23）后三张权威表存在，且既有业务表未被破坏；</li>
 *   <li>job/source 状态 write-through 后读取一致（状态、phase、计数、per-source 状态、错误码）；</li>
 *   <li>operationId 幂等是持久的且按 subject 分域：重启后同一 identity 拿回同一 jobId，
 *       job 被清理后同一 operationId 可重新创建；</li>
 *   <li>TTL 只回收「终态且已过期」的投影，不碰 QUEUED/PROCESSING；</li>
 *   <li>新进程（新注册表实例）能恢复状态，且**不会**把可恢复 job 的本地产物当孤儿删除。</li>
 * </ul>
 */
@Testcontainers(disabledWithoutDocker = true)
class ReplayJobAuthorityPostgresTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    private static JdbcClient jdbc;

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
            jdbc = JdbcClient.create(new DriverManagerDataSource(
                    POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        }
        // source / operation 由外键 cascade 删除，一条 delete 即可复位。
        jdbc.sql("delete from replay_processing_job").update();
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
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);
        final ReplayProcessingJob job =
                new ReplayProcessingJob("p-1", List.of("a.wotbreplay", "b.wotbreplay"));
        job.startProcessing();
        job.markSourceProcessing(0, "a.wotbreplay");
        authority.save(job);

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
    }

    @Test
    void repeatedSaveOverwritesProgressCountersAndTerminalState() {
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);
        final ReplayProcessingJob job = new ReplayProcessingJob("p-2", List.of("a.wotbreplay"));
        job.startProcessing();
        authority.save(job);

        job.markSourceReady(0);
        job.recordParseSuccess();
        job.markFailed("REPLAY_UNREADABLE");
        authority.save(job);

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
    void commitOperationIsIdempotentAndScopedBySubject() {
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);
        authority.save(new ReplayProcessingJob("p-3", List.of("a.wotbreplay")));

        assertTrue(authority.commitOperation("user-1", "op-1", "p-3"));
        assertFalse(authority.commitOperation("user-1", "op-1", "p-3"),
                "同一 identity 只允许一次 COMMITTED");
        assertEquals("p-3", authority.findCommittedJobId("user-1", "op-1"));
        assertNull(authority.findCommittedJobId("user-2", "op-1"),
                "operationId 必须按 authenticated subject 分域");
    }

    @Test
    void committedIndexDisappearsWhenJobIsCleaned() {
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);
        authority.save(new ReplayProcessingJob("p-4", List.of("a.wotbreplay")));
        authority.commitOperation("user-1", "op-4", "p-4");

        authority.deleteJob("p-4");

        assertTrue(authority.findJob("p-4").isEmpty());
        assertTrue(authority.listJobIds().isEmpty());
        assertNull(authority.findCommittedJobId("user-1", "op-4"),
                "job 已清理后同一 operationId 必须可重新创建");
        assertEquals(0, jdbc.sql("select count(*) from replay_processing_source")
                .query(Integer.class).single());
        assertEquals(0, jdbc.sql("select count(*) from replay_processing_operation")
                .query(Integer.class).single());
    }

    @Test
    void deleteExpiredTerminalRemovesOnlyExpiredTerminalJobs() {
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);
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
    void newStoreInstanceRestoresStateAndKeepsRecoverableJobArtifacts() throws Exception {
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);

        final ReplayProcessingJobStore first = new ReplayProcessingJobStore(tempDir, 60, authority);
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob("p-5", List.of("a.wotbreplay"));
            first.register(job);
            job.startProcessing();
            job.markSourceReady(0);
            job.recordParseSuccess();
        } finally {
            first.close();
        }
        final Path uploadedInput = first.inputDir("p-5").resolve("0__a.wotbreplay");
        Files.createDirectories(uploadedInput.getParent());
        Files.writeString(uploadedInput, "bytes");

        final ReplayProcessingJobStore restarted = new ReplayProcessingJobStore(tempDir, 60, authority);
        try {
            final ReplayProcessingJob restored = restarted.get("p-5");
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
    void operationIdIdempotencySurvivesStoreRestart() {
        final ReplayJobAuthority authority = new ReplayJobAuthority(jdbc);
        final ReplayProcessingJobStore first = new ReplayProcessingJobStore(tempDir, 60, authority);
        try {
            first.register(new ReplayProcessingJob("p-6", List.of("a.wotbreplay")));
            first.commitOperation("user-1", "op-6", CompletableFuture.completedFuture("p-6"), "p-6");
        } finally {
            first.close();
        }

        final ReplayProcessingJobStore restarted = new ReplayProcessingJobStore(tempDir, 60, authority);
        try {
            assertEquals("p-6", restarted.jobIdForOperation("user-1", "op-6"));
            assertNull(restarted.jobIdForOperation("user-2", "op-6"));
        } finally {
            restarted.close();
        }
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
