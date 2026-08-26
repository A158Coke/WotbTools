package com.wotb.web.replay.controller;

import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.replay.job.ExportJob;
import com.wotb.web.replay.job.ReplayExportJobService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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
 * Export Job HTTP 边界契约回归（生产 500 INTERNAL_ERROR 根因：Processing result reuse
 * 请求是 bodyless POST，而 @PostMapping 强制 consumes=multipart/form-data →
 * HttpMediaTypeNotSupportedException 落入 generic Exception handler → 500）。
 *
 * <p>修复后契约：POST /api/replay/export-jobs 不强制 multipart，同时支持
 * multipart 上传 / bodyless processingJobId reuse / multipart teamNames reuse，
 * client contract == controller contract == service contract。</p>
 */
class ReplayExportJobControllerContractTest {

    private MockMvc mvc;
    private ReplayExportJobService service;

    @BeforeEach
    void setUp() {
        service = mock(ReplayExportJobService.class);
        // Mockito last-matching-stub wins：先注册宽匹配，后注册精确 teamNames stub。
        when(service.createJob(isNull(), eq("aggregate"), eq("p1"), any())).thenReturn("job-1");
        when(service.createJob(isNull(), eq("aggregate"), eq("p1"),
                eq("{\"summary\":{\"clan:CHRD\":\"Y\"}}"))).thenReturn("job-2");
        when(service.createJob(any(), eq("aggregate"), isNull(), isNull())).thenReturn("job-3");
        when(service.status("job-1")).thenReturn(snap("job-1"));
        when(service.status("job-2")).thenReturn(snap("job-2"));
        when(service.status("job-3")).thenReturn(snap("job-3"));
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
        // 生产截图请求形态：POST /api/replay/export-jobs?mode=aggregate&processingJobId=p1
        // （无 body、无 multipart Content-Type）。不得 415 / 500 / INTERNAL_ERROR。
        mvc.perform(post("/api/replay/export-jobs?mode=aggregate&processingJobId=p1"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.jobId").value("job-1"))
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.total").value(34));
        verify(service).createJob(isNull(), eq("aggregate"), eq("p1"), isNull());
    }

    @Test
    void multipartUploadIsStillAccepted() throws Exception {
        mvc.perform(multipart("/api/replay/export-jobs")
                        .file(new MockMultipartFile("files", "a.wotbreplay",
                                "application/octet-stream", new byte[]{1}))
                        .param("mode", "aggregate"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.jobId").value("job-3"));
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
