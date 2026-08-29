package com.wotb.web.replay.controller;

import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.TacticalReviewHarness;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayProcessingJob;
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
import static org.mockito.Mockito.mock;

/**
 * Dataset JSON reference REST 契约——缺失/空引用 → 400
 * DATASET_REFERENCE_REQUIRED、非法 sourceId → 400 SOURCE_NOT_FOUND、
 * job 不存在/过期 → 404 JOB_NOT_FOUND、source 未 READY → 409 SOURCE_NOT_READY。
 * 绝不允许 null processingJobId 进入 store 查找 NPE → 500。
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
        store = new ReplayProcessingJobStore(root, 60);
        final AiReplayReviewService reviewService = new AiReplayReviewService(
                mock(AiReplayAnalysisService.class),
                mock(TacticalReviewHarness.class),
                null,
                store);
        controller = new ReconstructionController(
                reviewService,
                mock(AiCancellationRegistry.class),
                mock(AiReviewWorkerExecutor.class),
                new MapOverviewQueryService(store));
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
    void analyzeMissingReferencesReturn400DatasetReferenceRequired() throws Exception {
        newController();
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.analyzeDataset(null));
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.analyzeDataset(new ReconstructionController.AnalyzeDatasetRequest(
                        null, "r0", "zh", null)));
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.analyzeDataset(new ReconstructionController.AnalyzeDatasetRequest(
                        "  ", "r0", "zh", null)));
        assertContract(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED",
                () -> controller.analyzeDataset(new ReconstructionController.AnalyzeDatasetRequest(
                        "p1", null, "zh", null)));
    }

    @Test
    void analyzeInvalidSourceIdReturns400SourceNotFound() throws Exception {
        newController();
        assertContract(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND",
                () -> controller.analyzeDataset(new ReconstructionController.AnalyzeDatasetRequest(
                        "p1", "not-a-source", "zh", null)));
    }

    @Test
    void analyzeValidReferenceProceedsPastReferenceValidation() throws Exception {
        newController();
        store.register(readyJob("p-ready"));
        // 合法 reference 通过同步字段校验 → 走到 cancellation registry（mock 返回 null →
        // DUPLICATE_CORRELATION_ID），证明没有 NPE / 500，且 reference validation 已放行。
        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> controller.analyzeDataset(new ReconstructionController.AnalyzeDatasetRequest(
                        "p-ready", "r0", "zh", null)));
        assertEquals("DUPLICATE_CORRELATION_ID", e.getMessage());
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
}
