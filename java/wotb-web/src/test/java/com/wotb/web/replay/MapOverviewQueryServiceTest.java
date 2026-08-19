package com.wotb.web.replay;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@code /api/replay/map-overview} 查询服务契约：只解析回放、不调 AI；
 * 校验/错误码与 analyze 一致；地图不可构建时返回 null（由控制器转 204）。
 * 正路径用真实 fixture（与 MapOverviewBuilderTest 同源）。
 */
class MapOverviewQueryServiceTest {

    private static Path fixture() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replays", "random-battle-example.wotbreplay").normalize();
    }

    private static MultipartFile fixtureFile() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        return new MockMultipartFile("files", fixture().getFileName().toString(), null, bytes);
    }

    @Test
    void buildsOverviewFromFixtureWithoutAnyAi() throws Exception {
        final MapOverviewQueryService service =
                new MapOverviewQueryService(new DefaultReplayProcessingFacade());
        final MapOverview overview = service.buildOverview(new MultipartFile[]{fixtureFile()});
        assertNotNull(overview, "fixture 应产出完整地图鸟瞰");
        assertEquals("rift", overview.mapCode());
        assertEquals(14, overview.routes().size());
        assertNotNull(overview.playback(), "战局回放数据应存在");
    }

    @Test
    void throwsNoBattleDataWhenBattleUnparsed() throws Exception {
        final DefaultReplayProcessingFacade facade = mock(DefaultReplayProcessingFacade.class);
        when(facade.process(any(), any())).thenReturn(new ReplayProcessingResult(
                "x.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null,
                null, null, null, null));
        final MapOverviewQueryService service = new MapOverviewQueryService(facade);
        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.buildOverview(new MultipartFile[]{fixtureFile()}));
        assertEquals("NO_BATTLE_DATA", e.getMessage());
    }

    @Test
    void requestsFullTimelineReconstructionLikeAnalyze() throws Exception {
        final DefaultReplayProcessingFacade facade = mock(DefaultReplayProcessingFacade.class);
        when(facade.process(any(), any())).thenReturn(new ReplayProcessingResult(
                "x.wotbreplay", ReplayProcessingStatus.SUCCESS, null, null, null,
                null, null, null, null));
        final MapOverviewQueryService service = new MapOverviewQueryService(facade);
        assertThrows(IllegalArgumentException.class,
                () -> service.buildOverview(new MultipartFile[]{fixtureFile()}));
        final ArgumentCaptor<ReplayProcessingOptions> options =
                ArgumentCaptor.forClass(ReplayProcessingOptions.class);
        verify(facade).process(any(), options.capture());
        assertEquals(true, options.getValue().reconstructTimeline(),
                "地图鸟瞰需要完整事件流重建（与 analyze 同口径）");
    }

    @Test
    void returnsNullWhenOverviewNotBuildable() throws Exception {
        final DefaultReplayProcessingFacade facade = mock(DefaultReplayProcessingFacade.class);
        // battle 可解析但 reconstruction 缺失（重建失败被保留）：builder 降级 null
        when(facade.process(any(), any())).thenReturn(new ReplayProcessingResult(
                "x.wotbreplay", ReplayProcessingStatus.SUCCESS, null, new Battle(), null,
                null, null, null, null));
        final MapOverviewQueryService service = new MapOverviewQueryService(facade);
        assertNull(service.buildOverview(new MultipartFile[]{fixtureFile()}));
    }

    @Test
    void rejectsEmptyUploadsWithStableCodes() {
        final MapOverviewQueryService service =
                new MapOverviewQueryService(mock(DefaultReplayProcessingFacade.class));
        final IllegalArgumentException empty = assertThrows(IllegalArgumentException.class,
                () -> service.buildOverview(new MultipartFile[]{}));
        assertEquals("NO_REPLAY_FILES", empty.getMessage());
        final MultipartFile[] twoFiles = new MultipartFile[]{
                new MockMultipartFile("files", "a.wotbreplay", null, new byte[]{1}),
                new MockMultipartFile("files", "b.wotbreplay", null, new byte[]{1})
        };
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.buildOverview(twoFiles));
    }
}
