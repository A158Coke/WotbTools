package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.storage.ObjectStorageKeys;
import com.wotb.web.replay.dto.PreviewResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 分布式模式的两条非解析路径（无需真实 MinIO / RabbitMQ）：
 *
 * <ul>
 *   <li><b>create</b>：上传写对象存储（键来自 {@code ObjectStorageKeys}），派发走
 *       {@code ReplayProcessingDispatcher}；派发失败必须让 create 失败且不留下任何 job 行；</li>
 *   <li><b>result</b>：READY 后 {@code GET .../result} 的数据集来自对象存储的 canonical per-source
 *       dataset，而不是进程内存。</li>
 * </ul>
 *
 * <p>同一个 {@link ReplayProcessingJobService} 在两种模式下都被复用；这里注入分布式端口
 * （{@link ReplayProcessingInputStore} / {@link ReplayProcessingResultReader}）即可，
 * 编排与状态机没有任何第二套实现。</p>
 */
class DistributedReplayProcessingPathsTest {

    private static final String INPUT_NAME = "round.wotbreplay";

    @TempDir
    Path tempDir;

    private ReplayProcessingJobStore store;
    private RecordingObjectStorage storage;
    private RecordingDispatcher dispatcher;
    private ReplayProcessingJobService service;

    @BeforeEach
    void setUp() {
        store = new ReplayProcessingJobStore(tempDir, 60);
        storage = new RecordingObjectStorage();
        dispatcher = new RecordingDispatcher();
        service = new ReplayProcessingJobService(store, dispatcher, null,
                new MinioReplayProcessingInputStore(storage),
                new ObjectStorageReplayProcessingResultReader(storage));
    }

    @AfterEach
    void tearDown() {
        store.close();
    }

    @Test
    void createUploadsInputToObjectStorageAndDispatchesOnce() throws Exception {
        final String jobId = service.createJob(new MultipartFile[]{file(INPUT_NAME)}, 0, null, null);

        final byte[] expected = {1, 2, 3};
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, "input/0/" + INPUT_NAME);
        assertTrue(storage.objects.containsKey(key.value()),
                "输入必须落在 temp/jobs/<jobId>/input/<index>/<name>，实际键: " + storage.objects.keySet());
        assertEquals(expected.length, storage.objects.get(key.value()).length);
        assertEquals("application/octet-stream", storage.contentTypes.get(key.value()));

        assertEquals(1, dispatcher.requests.size(), "create 必须恰好派发一次");
        final ReplayProcessingRequest request = dispatcher.requests.getFirst();
        assertEquals(jobId, request.jobId());
        assertEquals(ReplayProcessingRequest.FIRST_ATTEMPT, request.attempt(),
                "首次派发永远是 attempt 1；只有控制面逻辑重试才会递增");
        assertEquals(List.of(0), request.sources().stream().map(s -> s.sourceIndex()).toList());
        assertEquals(INPUT_NAME, request.sources().getFirst().sourceName());
        assertEquals(ReplayProcessingJob.Status.QUEUED, service.status(jobId).status());
    }

    @Test
    void dispatchFailureFailsCreateAndLeavesNoJobBehind() throws Exception {
        dispatcher.failure = new IllegalStateException("broker confirmation failed");

        assertThrows(IllegalStateException.class,
                () -> service.createJob(new MultipartFile[]{file(INPUT_NAME)}, 0, null, null));

        assertEquals(1, dispatcher.requests.size());
        final String jobId = dispatcher.requests.getFirst().jobId();
        assertNull(store.get(jobId), "派发失败的 create 绝不能留下一个永远不会有结果的 job");
        assertTrue(storage.objects.isEmpty(),
                "派发失败的 create 必须回滚已写入的 MinIO 输入，不能留下孤儿对象: " + storage.objects.keySet());
        try (var entries = Files.list(tempDir)) {
            assertEquals(0, entries.count(), "本地 job 目录同样必须被回收");
        }
    }

    /**
     * 半途失败：第 1 个输入已经写进对象存储、第 2 个失败。没有 job 会引用第 1 个对象，
     * 因此它必须被删除，而不是等 1 天的桶生命周期兜底。
     */
    @Test
    void partialInputWriteFailureRollsBackTheAlreadyWrittenInputs() throws Exception {
        storage.putFailureAt = 1;

        assertThrows(IllegalStateException.class, () -> service.createJob(
                new MultipartFile[]{file("a.wotbreplay"), file("b.wotbreplay")}, 0, null, null));

        assertTrue(storage.objects.isEmpty(),
                "半途失败的 create 必须删除已写入的输入: " + storage.objects.keySet());
        assertTrue(dispatcher.requests.isEmpty(), "输入都没写完整就绝不能派发");
        try (var entries = Files.list(tempDir)) {
            assertEquals(0, entries.count(), "本地 job 目录同样必须被回收");
        }
    }

    /** 权威登记失败：输入已经在对象存储里，必须连带回滚，且不留下任何 job。 */
    @Test
    void registrationFailureRollsBackMinioInputsAndLeavesNoJob() throws Exception {
        final ReplayProcessingJobStore failingStore = new FailingRegistrationStore(tempDir, 60);
        try {
            final ReplayProcessingJobService failingService = new ReplayProcessingJobService(
                    failingStore, dispatcher, null,
                    new MinioReplayProcessingInputStore(storage),
                    new ObjectStorageReplayProcessingResultReader(storage));

            final IllegalStateException failure = assertThrows(IllegalStateException.class, () -> failingService
                    .createJob(new MultipartFile[]{file(INPUT_NAME)}, 0, null, null));

            assertEquals("authority unavailable", failure.getMessage());
            assertTrue(storage.objects.isEmpty(), "登记失败的 create 必须回滚已写入的 MinIO 输入");
            assertTrue(dispatcher.requests.isEmpty(), "登记失败绝不能派发");
        } finally {
            failingStore.close();
        }
    }

    /**
     * 回滚本身失败（例如对象存储身份没有删除权限）时，**原始 create 失败必须原样浮出**：
     * 清理是尽力而为的补救，绝不能把「派发失败」改写成「存储失败」。
     */
    @Test
    void inputRollbackFailureDoesNotReplaceTheOriginalCreateFailure() throws Exception {
        dispatcher.failure = new IllegalStateException("broker confirmation failed");
        storage.deleteFailure = new IOException("simulated delete denied");

        final IllegalStateException failure = assertThrows(IllegalStateException.class,
                () -> service.createJob(new MultipartFile[]{file(INPUT_NAME)}, 0, null, null));

        assertEquals("broker confirmation failed", failure.getMessage(),
                "输入回滚失败必须被吞掉并记录，绝不替换原始 create 失败");
        assertNull(store.get(dispatcher.requests.getFirst().jobId()), "权威状态回收不受回滚失败影响");
    }

    @Test
    void resultIsServedFromObjectStorageCanonicalDataset() throws Exception {
        final String jobId = service.createJob(new MultipartFile[]{file(INPUT_NAME)}, 0, null, null);
        writeCanonicalDataset(jobId, 0, battle("arena-remote"));
        markReady(jobId);

        final PreviewResponse preview = service.result(jobId);

        assertEquals(1, preview.battles().size());
        assertEquals("arena-remote", preview.battles().getFirst().arenaId());
        assertNull(preview.league());
    }

    @Test
    void resultIsNotReadyWhenCanonicalDatasetIsMissing() throws Exception {
        final String jobId = service.createJob(new MultipartFile[]{file(INPUT_NAME)}, 0, null, null);
        markReady(jobId);

        final ResponseStatusException failure =
                assertThrows(ResponseStatusException.class, () -> service.result(jobId));
        assertEquals(HttpStatus.CONFLICT, failure.getStatusCode());
        assertEquals("JOB_NOT_READY", failure.getReason());
    }

    private void markReady(final String jobId) {
        final ReplayProcessingJob job = store.get(jobId);
        assertNotNull(job);
        assertTrue(job.startProcessing());
        job.markSourceReady(0);
        job.recordParseSuccess();
        assertTrue(job.markReady());
    }

    private void writeCanonicalDataset(final String jobId, final int sourceIndex, final Battle battle) {
        final RemoteSourceDataset dataset = new RemoteSourceDataset(
                RemoteSourceDataset.SCHEMA_VERSION, sourceIndex, INPUT_NAME,
                List.of(battle), List.of(INPUT_NAME), List.of("temp/jobs/" + jobId + "/input/0/" + INPUT_NAME),
                List.of(), List.of(), null);
        final byte[] body = JsonMapper.builder().build().writeValueAsBytes(dataset);
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, "result/source-" + sourceIndex + ".json");
        storage.objects.put(key.value(), body);
        storage.contentTypes.put(key.value(), "application/json");
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

    private static MultipartFile file(final String name) {
        return new MockMultipartFile("files", name, "application/octet-stream", new byte[]{1, 2, 3});
    }

    /** 记录写入/删除的最小 {@link ObjectStorage} 替身（对象存储端口没有 list/prefix 操作）。 */
    private static final class RecordingObjectStorage implements ObjectStorage {

        private final Map<String, byte[]> objects = new LinkedHashMap<>();
        private final Map<String, String> contentTypes = new LinkedHashMap<>();
        private final List<String> deleted = new ArrayList<>();
        /** 在第 N 次 put 时失败（0-based，按当前对象数判定）；{@code null} = 从不失败。 */
        private Integer putFailureAt;
        /** put 失败的异常；默认 {@link IOException}。 */
        private IOException putFailure;
        /** 非 null 时所有 delete 都以它失败（模拟清理权限/网络故障）。 */
        private IOException deleteFailure;

        @Override
        public void put(final ObjectKey key, final InputStream content, final long contentLength,
                        final String contentType) throws IOException {
            if (putFailureAt != null && objects.size() == putFailureAt) {
                throw putFailure != null ? putFailure : new IOException("simulated put outage");
            }
            objects.put(key.value(), content.readAllBytes());
            contentTypes.put(key.value(), contentType);
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
            if (deleteFailure != null) {
                throw deleteFailure;
            }
            objects.remove(key.value());
            contentTypes.remove(key.value());
            deleted.add(key.value());
        }
    }

    /** 权威登记固定失败（模拟 PostgreSQL 权威投影不可用）。 */
    private static final class FailingRegistrationStore extends ReplayProcessingJobStore {

        private FailingRegistrationStore(final Path root, final int ttlMinutes) {
            super(root, ttlMinutes);
        }

        @Override
        public void register(final ReplayProcessingJob job) {
            throw new IllegalStateException("authority unavailable");
        }
    }

    /** 记录派发请求、可按需失败的 {@link ReplayProcessingDispatcher} 替身。 */
    private static final class RecordingDispatcher implements ReplayProcessingDispatcher {

        private final List<ReplayProcessingRequest> requests = new ArrayList<>();
        private RuntimeException failure;

        @Override
        public void submit(final ReplayProcessingRequest request) {
            requests.add(request);
            if (failure != null) {
                throw failure;
            }
        }

        @Override
        public CancellationResult cancelQueued(final String jobId) {
            return CancellationResult.ACTIVE_COMPLETION_PENDING;
        }
    }
}
