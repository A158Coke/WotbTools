package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.processing.ReplayIdentity;
import com.wotb.storage.ObjectStorageKeys;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.dto.PreviewResponse;
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
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * backend 重启后的分布式读取能力（真实 PostgreSQL + {@link ObjectStorage} 替身）。
 *
 * <p>不变式（{@code docs/DEVELOPER_GUIDE.md}「Replay 执行模式」）：**PostgreSQL = lifecycle 权威，
 * MinIO = dataset / artifact 权威，TX 本地磁盘与 JVM 状态不得是 distributed 生产读取的前提**。
 * 重启是常规运维事件，因此：</p>
 *
 * <ol>
 *   <li>进程 1 跑完收尾（写 {@code result/finalized.json} + per-source dataset），PG 置 READY；</li>
 *   <li>丢弃进程 1 的 store；</li>
 *   <li>进程 2 用同一个 PG 权威开一个**全新 store**（live registry 必然为空）；</li>
 *   <li>GET result / Map Overview / Battle Playback V2 / AI Review artifact / Export 必须全部可用，
 *       且不重新解析、不依赖任何 TX 本地 job 目录（本测试的 store 根目录下不存在该 job 的任何文件）。</li>
 * </ol>
 */
@Testcontainers(disabledWithoutDocker = true)
class DistributedRestartRecoveryTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    private static final String INPUT_NAME = "round.wotbreplay";
    private static final long AWAIT_TIMEOUT_MILLIS = 15_000L;

    private static JdbcClient jdbc;
    private static PlatformTransactionManager transactions;

    @TempDir
    Path tempDir;

    private RecordingStorage storage;
    private String jobId;

    @BeforeEach
    void migrateOnceThenResetAuthorityTables() {
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
        storage = new RecordingStorage();
        jobId = "restart-" + UUID.randomUUID();
    }

    @Test
    void readyJobRemainsFullyReadableAfterBackendRestart() throws Exception {
        // ---- 进程 1：收尾产出 finalized.json，artifact 由 worker 写进对象存储 ----
        final ReplayProcessingJobStore first =
                new ReplayProcessingJobStore(tempDir.resolve("first"), 60, authority());
        try {
            final ReplayProcessingJob job = new ReplayProcessingJob(jobId, List.of(INPUT_NAME));
            first.register(job);
            job.startProcessing();
            job.markSourceReady(0);
            job.recordParseSuccess();
            putSourceDataset(jobId);
            // artifact 一律用生产内容生成器产出（与 worker 写出的字节同源），避免手写 JSON 掩盖真实契约。
            putArtifact(ReplayArtifactWriter.AI_FACTS_NAME, requireContent(ReplayArtifactWriter.aiFactsContent(result())));
            putArtifact(ReplayArtifactWriter.MAP_OVERVIEW_NAME,
                    requireContent(ReplayArtifactWriter.mapOverviewContent(overview())));
            putArtifact(ReplayArtifactWriter.BATTLE_PLAYBACK_V2_NAME,
                    requireContent(ReplayArtifactWriter.battlePlaybackV2Content(playback())));

            job.advancePhase(ReplayProcessingJob.PHASE_FINALIZING_BATCH);
            new ObjectStorageReplayDatasetRepository(storage).finalizeBatch(job);
            job.markReady();
        } finally {
            first.close();
        }

        // 进程 1 的本地 job 目录绝不参与读取：store 根目录下没有任何该 job 的文件。
        assertTrue(!java.nio.file.Files.exists(tempDir.resolve("first").resolve(jobId)),
                "distributed 读取不得依赖 TX 本地 job 目录");

        // ---- 进程 2：全新 store（live registry 为空）+ 同一个 PG 权威 ----
        final ReplayProcessingJobStore restarted =
                new ReplayProcessingJobStore(tempDir.resolve("second"), 60, authority());
        final ObjectStorageReplayDatasetRepository repository = new ObjectStorageReplayDatasetRepository(storage);
        try {
            // live registry 必须为空：GET 只能经权威恢复。
            assertNotNull(restarted.get(jobId), "重启后必须能从 PG 权威恢复可读 job");
            assertNull(restarted.get("no-such-job"));

            // 1) GET result
            final ReplayProcessingJobService service = new ReplayProcessingJobService(
                    restarted, new NoDispatchDispatcher(), null, null, repository);
            final PreviewResponse preview = service.result(jobId);
            assertEquals(1, preview.battles().size(), "finalized dataset 必须可读");
            assertEquals("arena-restart", preview.battles().getFirst().arenaId());

            // 2) Map Overview + Battle Playback V2（经 Dataset Lease + 对象存储 artifact）
            final MapOverviewQueryService mapOverview = new MapOverviewQueryService(restarted, repository);
            final MapOverview overview = mapOverview.buildOverviewFromDataset(jobId, 0);
            assertNotNull(overview, "重启后 Map Overview 必须可用");
            assertEquals("restart_map", overview.mapCode());
            final BattlePlaybackDataset playback = mapOverview.buildBattlePlaybackFromDataset(jobId, 0);
            assertNotNull(playback, "重启后 Battle Playback V2 必须可用");
            assertEquals("restart_map", playback.mapCode());

            // 3) AI Review 的 ai-facts artifact（对象存储，从 PG 恢复的 jobId 直接可读）
            final AiReplayFacts facts =
                    ReplayArtifactWriter.decodeAiFacts(repository.aiFacts(jobId, 0));
            assertNotNull(facts, "重启后 ai-facts 必须从对象存储读到");
            assertNotNull(facts.battle(), "ai-facts 必须是可消费的 canonical facts");

            // 4) Export：必须接受权威恢复出来的 READY 投影
            final ReplayExportWorkerExecutor executor = new ReplayExportWorkerExecutor(1, 1);
            try {
                final ReplayExportJobService export = new ReplayExportJobService(
                        new ExportJobStore(tempDir.resolve("export").toString(), 60), executor,
                        restarted, repository, null);
                final String exportJobId = export.createJob("aggregate", jobId);
                final ExportJob.Snapshot snapshot = awaitTerminal(export, exportJobId);
                assertEquals(ExportJob.Status.READY, snapshot.status(),
                        "重启后 Export 必须能消费 finalized dataset");
                assertTrue(snapshot.total() > 0, "total 必须来自 dataset（不重新解析）");
            } finally {
                executor.close();
            }
        } finally {
            restarted.close();
        }
    }

    private ReplayJobAuthority authority() {
        return new PostgresReplayJobAuthority(jdbc, transactions);
    }

    /** worker 写的 canonical per-source dataset（收尾的输入）。 */
    private void putSourceDataset(final String jobId) throws IOException {
        final RemoteSourceDataset dataset = new RemoteSourceDataset(
                RemoteSourceDataset.SCHEMA_VERSION, 0, INPUT_NAME,
                List.of(battle("arena-restart")), List.of(INPUT_NAME), List.of("r0"),
                List.of(), List.of(), null);
        put(jobId, "result/source-0.json", JsonMapper.builder().build().writeValueAsBytes(dataset));
    }

    private void putArtifact(final String artifactName, final byte[] body) {
        put(jobId, "artifacts/0/" + artifactName, body);
    }

    private static byte[] requireContent(final byte[] content) {
        assertNotNull(content, "artifact 内容生成器不得返回 null（capability unavailable 时该 artifact 本就不写）");
        return content;
    }

    /** 与 worker 落盘/上传的 artifact 同源的内容 fixture。 */
    private static ReplayProcessingResult result() {
        final Battle battle = new Battle();
        battle.arenaId = "arena-restart";
        battle.mapName = "restart_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = "Player123";
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = 1001L;
        recorder.nickname = "Player123";
        recorder.team = 1;
        recorder.damageDealt = 1_000;
        recorder.survived = true;
        battle.players = List.of(recorder);
        final ReplayProcessingCapabilities capabilities = new ReplayProcessingCapabilities(true, true, false, false, false);
        return new ReplayProcessingResult(
                "round.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("h", "arena-restart", "11.0", "restart_map", 1001L, null),
                battle, null, null, capabilities, null, null);
    }

    private static MapOverview overview() {
        return new MapOverview(
                "restart_map", "Restart Map", Map.of("zh", "重启地图"), 1,
                new MapOverview.Bounds(0, 500, 0, 500), List.of(), null,
                List.of(), List.of(), null, List.of(),
                1, 1001L);
    }

    private static BattlePlaybackDataset playback() {
        return new BattlePlaybackDataset(
                300.0, "restart_map", 1, 1001L,
                List.of(), List.of(), List.of(), List.of(), List.of(),
                BattlePlaybackDataset.Capability.FULL, 1);
    }

    private void put(final String jobId, final String relativePath, final byte[] body) {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, relativePath);
        storage.objects.put(key.value(), body);
    }

    private static Battle battle(final String arenaId) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.winnerTeam = 1;
        battle.players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult player = new PlayerResult();
            player.accountId = i + 1L;
            player.nickname = "p" + (i + 1);
            player.team = i < 7 ? 1 : 2;
            player.tankId = 4481L;
            battle.players.add(player);
        }
        return battle;
    }

    private static ExportJob.Snapshot awaitTerminal(final ReplayExportJobService service, final String exportJobId)
            throws InterruptedException {
        final long deadline = System.currentTimeMillis() + AWAIT_TIMEOUT_MILLIS;
        while (System.currentTimeMillis() < deadline) {
            final ExportJob.Snapshot snapshot = service.status(exportJobId);
            if (snapshot.status() == ExportJob.Status.READY || snapshot.status() == ExportJob.Status.FAILED
                    || snapshot.status() == ExportJob.Status.CANCELLED) {
                return snapshot;
            }
            Thread.sleep(20);
        }
        return service.status(exportJobId);
    }

    /** 只读测试不需要派发：任何 submit 都是编程错误。 */
    private static final class NoDispatchDispatcher implements ReplayProcessingDispatcher {

        @Override
        public void submit(final ReplayProcessingRequest request) {
            throw new IllegalStateException("restart recovery must not dispatch " + request.jobId());
        }

        @Override
        public CancellationResult cancelQueued(final String jobId) {
            return CancellationResult.NO_COMPLETION_PENDING;
        }
    }

    /** 对象存储替身（真实 adapter 的 Testcontainers 覆盖在 `MinioObjectStorageTest`）。 */
    private static final class RecordingStorage implements ObjectStorage {

        private final Map<String, byte[]> objects = new LinkedHashMap<>();

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
        public void delete(final ObjectKey key) {
            objects.remove(key.value());
        }
    }
}
