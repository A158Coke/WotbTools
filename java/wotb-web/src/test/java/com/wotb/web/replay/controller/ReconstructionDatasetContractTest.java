package com.wotb.web.replay.controller;

import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.job.InMemoryReplayJobAuthority;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.InMemoryReplayDatasetRepository;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Dataset JSON reference REST 契约——缺失/空引用 → 400
 * DATASET_REFERENCE_REQUIRED、非法 sourceId → 400 SOURCE_NOT_FOUND、
 * job 不存在/过期 → 404 JOB_NOT_FOUND、source 未 READY → 409 SOURCE_NOT_READY。
 * 绝不允许 null processingJobId 进入 store 查找 NPE → 500。
 * <p>AI 复盘（{@code /api/replay/analyze}）已迁出 wotb-web 到独立 ai-service；
 * 本测试只覆盖仍归 wotb-web 所有的 map-overview Dataset 路径。</p>
 */
class ReconstructionDatasetContractTest {

    private ReplayProcessingJobStore store;
    private Path root;
    private ReconstructionController controller;

    @AfterEach
    void tearDown() {
        if (store != null) {
            store.close();
        }
    }

    private void newController() throws Exception {
        root = Files.createTempDirectory("wotb-dataset-contract-test");
        store = new ReplayProcessingJobStore(root, 60, new InMemoryReplayJobAuthority());
        controller = new ReconstructionController(
                new MapOverviewQueryService(store, new InMemoryReplayDatasetRepository()));
    }

    private static ReplayProcessingJob notReadyJob(final String id) {
        return new ReplayProcessingJob(id, List.of("a.wotbreplay"));
    }

    private static ReplayProcessingJob readyJob(final String id) {
        final ReplayProcessingJob job = notReadyJob(id);
        job.startProcessing();
        job.markSourceReady(0);
        job.markReady(new ProcessedDataset(
                List.of(), List.of(), List.<String[]>of(), List.<String[]>of(), null, null));
        return job;
    }

    private static void assertContract(
            final HttpStatus status, final String code, final Runnable call) {
        final ResponseStatusException e = assertThrows(ResponseStatusException.class, call::run);
        assertEquals(status, e.getStatusCode(), "HTTP status for " + code);
        assertEquals(code, e.getReason(), "稳定错误码");
    }

    @Test
    void mapOverviewMissingReferencesReturn400DatasetReferenceRequired() throws Exception {
        newController();
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.mapOverviewDataset(null));
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest(
                        null, "r0")));
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest(
                        "p1", "")));
    }

    @Test
    void mapOverviewUnknownJobReturns404JobNotFound() throws Exception {
        newController();
        assertContract(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND",
                () -> controller.mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest(
                        "missing-job", "r0")));
    }

    @Test
    void mapOverviewSourceNotReadyReturns409SourceNotReady() throws Exception {
        newController();
        store.register(notReadyJob("p-map"));
        assertContract(HttpStatus.CONFLICT, "SOURCE_NOT_READY",
                () -> controller.mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest(
                        "p-map", "r0")));
    }

    @Test
    void mapOverviewInvalidSourceIdReturns400SourceNotFound() throws Exception {
        newController();
        assertContract(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND",
                () -> controller.mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest(
                        "p1", "bogus")));
    }

    @Test
    void mapOverviewReadyJobWithoutCachedArtifactReturns204() throws Exception {
        newController();
        store.register(readyJob("p-ready"));
        // 引用校验通过 → 读到 READY job 但无 cached map-overview 产物 → 204（而非 4xx/5xx）。
        assertEquals(204, controller.mapOverviewDataset(
                        new ReconstructionController.MapOverviewDatasetRequest("p-ready", "r0"))
                .getStatusCode().value());
    }
}
