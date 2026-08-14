package com.wotb.web.replay.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * {@code /api/replay/map-overview} 端点契约：200 + MapOverview JSON；地图不可构建
 * → 204 空响应；请求同步执行、不进入 SSE/AI worker 路径。
 * MapOverview 的 JSON 字段形状契约见 MapOverviewBuilderTest#jsonContractMatchesFrontendConsumption。
 */
class ReconstructionControllerMapOverviewTest {

    private static final MapOverview SAMPLE = new MapOverview(
            "desert_train", "Desert Sands",
            Map.of("zh", "黄沙荒漠", "en", "Desert Sands", "ru", "Пустынные пески"),
            2,
            new MapOverview.Bounds(-256, 260, -251, 254.3),
            List.of(), null, List.of(), List.of(), null, List.of(),
            null, null, null);

    private static final MultipartFile[] FILES = new MultipartFile[]{
            new MockMultipartFile("files", "a.wotbreplay", null, new byte[]{1})};

    private ReconstructionController controller(final MapOverview overview) throws Exception {
        final MapOverviewQueryService service = mock(MapOverviewQueryService.class);
        when(service.buildOverview(any())).thenReturn(overview);
        return new ReconstructionController(
                mock(DefaultReplayProcessingFacade.class),
                mock(AiReplayReviewService.class),
                new AiCancellationRegistry(),
                new AiReviewWorkerExecutor(),
                service, null);
    }

    @Test
    void returnsOverviewWith200WhenBuildable() throws Exception {
        final ResponseEntity<MapOverview> response = controller(SAMPLE).mapOverview(FILES);
        assertEquals(200, response.getStatusCode().value());
        assertEquals("desert_train", response.getBody().mapCode());
    }

    @Test
    void returns204WhenOverviewNotBuildable() throws Exception {
        final ResponseEntity<MapOverview> response = controller(null).mapOverview(FILES);
        assertEquals(204, response.getStatusCode().value());
        assertEquals(null, response.getBody());
    }
}
