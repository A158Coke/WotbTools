package com.wotb.web.replay.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * {@code /api/replay/map-overview} Dataset 路径契约（BLOCKER 2）：JSON 引用读取
 * cached map-overview.json → 200；不可构建 → 204；multipart 上传路径已废弃 → 410
 * {@code REPLAY_LEGACY_DEPRECATED}（不再有 scheduler 之外的 full processing）。
 */
class ReconstructionControllerMapOverviewTest {

    private static final MapOverview SAMPLE = new MapOverview(
            "desert_train", "Desert Sands",
            Map.of("zh", "黄沙荒漠", "en", "Desert Sands", "ru", "Пустынные пески"),
            2,
            new MapOverview.Bounds(-256, 260, -251, 254.3),
            List.of(), null, List.of(), List.of(), null, List.of(),
            null, null, null);

    private ReconstructionController controller(final MapOverview overview) {
        final MapOverviewQueryService service = mock(MapOverviewQueryService.class);
        when(service.buildOverviewFromDataset(eq("p1"), eq(0))).thenReturn(overview);
        return new ReconstructionController(
                mock(AiReplayReviewService.class),
                new AiCancellationRegistry(),
                new AiReviewWorkerExecutor(),
                service);
    }

    @Test
    void datasetReturnsOverviewWith200WhenBuildable() {
        final ResponseEntity<MapOverview> response =
                controller(SAMPLE).mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest("p1", "r0"));
        assertEquals(200, response.getStatusCode().value());
        assertEquals("desert_train", response.getBody().mapCode());
    }

    @Test
    void datasetReturns204WhenOverviewNotBuildable() {
        final ResponseEntity<MapOverview> response =
                controller(null).mapOverviewDataset(new ReconstructionController.MapOverviewDatasetRequest("p1", "r0"));
        assertEquals(204, response.getStatusCode().value());
        assertEquals(null, response.getBody());
    }

    @Test
    void legacyMultipartMapOverviewReturnsGone() throws Exception {
        final MapOverviewQueryService service = mock(MapOverviewQueryService.class);
        final ReconstructionController controller = new ReconstructionController(
                mock(AiReplayReviewService.class),
                new AiCancellationRegistry(),
                new AiReviewWorkerExecutor(),
                service);
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> controller.mapOverview(new org.springframework.mock.web.MockMultipartFile[0]));
        assertEquals(HttpStatus.GONE, e.getStatusCode());
        verify(service, never()).buildOverviewFromDataset(anyString(), anyInt());
    }
}
