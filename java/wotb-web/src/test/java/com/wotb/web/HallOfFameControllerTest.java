package com.wotb.web;

import com.wotb.web.hof.controller.HallOfFameController;
import com.wotb.web.hof.dto.HallOfFamePageDto;
import com.wotb.web.hof.dto.HallOfFameRecordDto;
import com.wotb.web.hof.dto.HofVehicleOptionDto;
import com.wotb.web.hof.dto.ReplayDownload;
import com.wotb.web.controller.GlobalExceptionHandler;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.service.HallOfFameUploadService;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller HTTP 绑定测试 (standalone MockMvc + mock service, 无需 DB / postgres profile)。
 * 守住 @RequestParam/@PathVariable 参数名绑定 —— 这正是 -parameters 缺失会在运行时炸的地方。
 */
class HallOfFameControllerTest {

    private static final HallOfFamePageDto PAGE = new HallOfFamePageDto(List.of(), 1, 50, 0, 0);

    private static HallOfFameRecordDto dto() {
        return new HallOfFameRecordDto(1L, 1, 6481L, "FV4005",
                "Recorder1", 3200, "RANDOM", "milbase",
                "11.18.0", OffsetDateTime.now(), OffsetDateTime.now(), true);
    }

    private static HallOfFamePageDto pageOf(final HallOfFameRecordDto item) {
        return new HallOfFamePageDto(List.of(item), 1, 50, 1, 1);
    }

    private MockMvc mvc(final HallOfFameService svc) {
        return mvc(svc, mock(HallOfFameUploadService.class));
    }

    private MockMvc mvc(final HallOfFameService service, final HallOfFameUploadService uploadService) {
        return MockMvcBuilders.standaloneSetup(new HallOfFameController(service, uploadService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void listDefaultAndExplicitFilterParams() throws Exception {
        final HallOfFameService svc = mock(HallOfFameService.class);
        when(svc.search(any(), any(), any(), any(), any(), any(), anyInt(), anyInt())).thenReturn(PAGE);
        final MockMvc mvc = mvc(svc);
        mvc.perform(get("/api/hof")).andExpect(status().isOk());
        mvc.perform(get("/api/hof")
                        .param("battleType", "RATING")
                        .param("tankId", "6481")
                        .param("nation", "UK")
                        .param("vehicleType", "TANK_DESTROYER")
                        .param("tier", "10")
                        .param("nickname", "Coke")
                        .param("page", "2")
                        .param("size", "20"))
                .andExpect(status().isOk());
        verify(svc).search(eq("RATING"), eq(6481L), eq("UK"), eq("TANK_DESTROYER"),
                eq(10), eq("Coke"), eq(2), eq(20));
    }

    @Test
    void listReturnsDtoList() throws Exception {
        final HallOfFameService svc = mock(HallOfFameService.class);
        when(svc.search(any(), any(), any(), any(), any(), any(), anyInt(), anyInt())).thenReturn(pageOf(dto()));
        final String json = mvc(svc).perform(get("/api/hof"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Assertions.assertThat(json).contains("\"items\"");
        Assertions.assertThat(json).contains("\"totalItems\"");
        Assertions.assertThat(json).contains("\"FV4005\"");
        Assertions.assertThat(json).contains("\"RANDOM\"");
        Assertions.assertThat(json).contains("\"rank\":1");
    }

    @Test
    void vehicleOptionsDelegateAndReturnStableEnglishMetadata() throws Exception {
        final HallOfFameService service = mock(HallOfFameService.class);
        when(service.vehicleOptions()).thenReturn(List.of(
                new HofVehicleOptionDto(385L, "Progetto 65", "EUROPE", "MEDIUM_TANK", 10),
                new HofVehicleOptionDto(999_999L, "Legacy Tank", "OTHER", "OTHER", null)));

        final String json = mvc(service).perform(get("/api/hof/vehicle-options"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        Assertions.assertThat(json).contains("\"tankId\":385");
        Assertions.assertThat(json).contains("\"nation\":\"EUROPE\"");
        Assertions.assertThat(json).contains("\"type\":\"MEDIUM_TANK\"");
        Assertions.assertThat(json).contains("\"tier\":null");
        verify(service).vehicleOptions();
    }

    @Test
    void downloadDelegatesAndSetsContentDisposition() throws Exception {
        final HallOfFameService service = mock(HallOfFameService.class);
        when(service.downloadReplay(eq(42L))).thenReturn(
                new ReplayDownload(new byte[]{1, 2, 3}, "battle.wotbreplay"));

        final var res = mvc(service).perform(get("/api/hof/42/replay"))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        Assertions.assertThat(res.getContentAsByteArray()).containsExactly(1, 2, 3);
        final String cd = res.getHeader("Content-Disposition");
        Assertions.assertThat(cd).startsWith("attachment");
        Assertions.assertThat(cd).contains("battle.wotbreplay");
    }

    @Test
    void downloadMissingReplayReturns404() throws Exception {
        final HallOfFameService service = mock(HallOfFameService.class);
        when(service.downloadReplay(eq(7L))).thenThrow(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "REPLAY_FILE_NOT_FOUND"));
        mvc(service).perform(get("/api/hof/7/replay"))
                .andExpect(status().isNotFound());
    }

    @Test
    void uploadDelegatesToServiceAndReturnsSkippedReasonCode() throws Exception {
        final HallOfFameService service = mock(HallOfFameService.class);
        final HallOfFameUploadService uploadService = mock(HallOfFameUploadService.class);
        when(uploadService.upload(any())).thenReturn(Map.of(
                "status", "skipped",
                "arenaId", "arena-1",
                "reasonCode", "DUPLICATE_OR_UNKNOWN_RECORDER"
        ));

        final String json = mvc(service, uploadService)
                .perform(multipart("/api/hof/upload")
                        .file(new MockMultipartFile("file", "battle.wotbreplay",
                                "application/octet-stream", new byte[]{1})))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        Assertions.assertThat(json).contains("\"reasonCode\":\"DUPLICATE_OR_UNKNOWN_RECORDER\"");
        verify(uploadService).upload(any());
    }

    /**
     * 不支持战斗模式（训练房/联赛等）错误语义契约：upload 抛 UNSUPPORTED_BATTLE_TYPE →
     * GlobalExceptionHandler 统一错误格式 HTTP 400 {error: UNSUPPORTED_BATTLE_TYPE}，绝不返回 200 skipped。
     */
    @Test
    void uploadUnsupportedBattleTypeRejectsWith400() throws Exception {
        final HallOfFameService service = mock(HallOfFameService.class);
        final HallOfFameUploadService uploadService = mock(HallOfFameUploadService.class);
        when(uploadService.upload(any())).thenThrow(new IllegalArgumentException("UNSUPPORTED_BATTLE_TYPE"));

        final String json = mvc(service, uploadService)
                .perform(multipart("/api/hof/upload")
                        .file(new MockMultipartFile("file", "battle.wotbreplay",
                                "application/octet-stream", new byte[]{1})))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        Assertions.assertThat(json).contains("\"error\":\"UNSUPPORTED_BATTLE_TYPE\"");
        verify(uploadService).upload(any());
    }
}
