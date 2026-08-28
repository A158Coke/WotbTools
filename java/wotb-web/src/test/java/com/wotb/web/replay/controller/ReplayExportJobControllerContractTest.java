package com.wotb.web.replay.controller;

import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.replay.job.ExportJob;
import com.wotb.web.replay.job.ReplayExportJobService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Export Job HTTP 边界契约回归（BLOCKER 2：Export 收口 Dataset-only）。
 *
 * <p>契约：POST /api/replay/export-jobs 只接受 mode / processingJobId / teamNames，
 * 不再接受 replay files（无 multipart 首传路径）；processingJobId 缺失/空 → 410
 * REPLAY_LEGACY_DEPRECATED（service 统一裁决，保留 intentional 410 契约）；
 * 有 processingJobId 时 bodyless 或 multipart teamNames 均受支持。
 * client contract == controller contract == service contract（无 files/multipart 死参数）。</p>
 */
class ReplayExportJobControllerContractTest {

    private MockMvc mvc;
    private ReplayExportJobService service;

    @BeforeEach
    void setUp() {
        service = mock(ReplayExportJobService.class);
        // Mockito last-matching-stub wins：先注册宽匹配，后注册精确 teamNames stub。
        when(service.createJob(eq("aggregate"), eq("p1"), any())).thenReturn("job-1");
        when(service.createJob(eq("aggregate"), eq("p1"),
                eq("{\"summary\":{\"clan:CHRD\":\"Y\"}}"))).thenReturn("job-2");
        // 缺失 processingJobId → service 裁决 410（保留 intentional 410 contract）。
        when(service.createJob(eq("aggregate"), isNull(), isNull()))
                .thenThrow(new ResponseStatusException(HttpStatus.GONE, "REPLAY_LEGACY_DEPRECATED"));
        when(service.status("job-1")).thenReturn(snap("job-1"));
        when(service.status("job-2")).thenReturn(snap("job-2"));
        mvc = MockMvcBuilders.standaloneSetup(new ReplayExportJobController(service))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private static ExportJob.Snapshot snap(final String jobId) {
        return new ExportJob.Snapshot(jobId, "aggregate", ExportJob.Status.QUEUED, null,
                34, 0, 0, 0, null, null, null);
    }

    @Test
    void processingJobIdReuseWithoutBodyIsAccepted() throws Exception {
        // 生产请求形态：POST /api/replay/export-jobs?mode=aggregate&processingJobId=p1
        // （无 body、无 multipart Content-Type）。不得 415 / 500 / INTERNAL_ERROR。
        mvc.perform(post("/api/replay/export-jobs?mode=aggregate&processingJobId=p1"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.jobId").value("job-1"))
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.total").value(34));
        verify(service).createJob(eq("aggregate"), eq("p1"), isNull());
    }

    @Test
    void missingProcessingJobIdIsRejectedAsGone() throws Exception {
        // BLOCKER 2：无 processingJobId 的 create 不得再被当作 multipart 首传——必须稳定 410。
        mvc.perform(post("/api/replay/export-jobs?mode=aggregate"))
                .andExpect(status().isGone());
        verify(service).createJob(eq("aggregate"), isNull(), isNull());
    }

    @Test
    void processingJobIdReuseWithTeamNamesMultipartIsAccepted() throws Exception {
        // 复用 + teamNames：multipart form-field 传递（不拼 URL query），行为不回归。
        mvc.perform(multipart("/api/replay/export-jobs")
                        .param("teamNames", "{\"summary\":{\"clan:CHRD\":\"Y\"}}")
                        .param("mode", "aggregate")
                        .param("processingJobId", "p1"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.jobId").value("job-2"));
    }
}
