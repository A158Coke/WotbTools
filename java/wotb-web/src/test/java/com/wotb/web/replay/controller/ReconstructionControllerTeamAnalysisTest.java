package com.wotb.web.replay.controller;

import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.MixedAnalysisScopesException;
import com.wotb.core.replay.processing.PerspectiveTeamNotResolvedException;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;

/**
 * AI 复盘 Dataset 路径控制器契约：SSE 生命周期 + 稳定错误码映射 +
 * 语言透传 + correlation/语言白名单。multipart 上传入口已废弃（410
 * {@code REPLAY_LEGACY_DEPRECATED}，见 ReplayLegacyEndpointContractTest）；
 * AI 链路内部行为（团队/单场分支）由 AiReplayReviewServiceTest 覆盖。
 */
class ReconstructionControllerTeamAnalysisTest {

    private AiReplayReviewService reviewService;
    private AiReviewWorkerExecutor workerExecutor;
    private ReconstructionController controller;

    @BeforeEach
    void setUp() {
        reviewService = mock(AiReplayReviewService.class);
        workerExecutor = new AiReviewWorkerExecutor();
        controller = new ReconstructionController(reviewService, new AiCancellationRegistry(),
                workerExecutor, new MapOverviewQueryService(null));
    }

    @AfterEach
    void tearDown() {
        workerExecutor.close();
    }

    @Test
    void blankLangThrowsUnknownLocaleBeforeStreamStarts() throws Exception {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyzeDataset(request("", null)));
        verify(reviewService, never()).analyzeFacts(anyString(), anyInt(), any(AllowedLanguage.class), any());
    }

    @Test
    void unknownLangThrowsUnknownLocaleBeforeStreamStarts() throws Exception {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyzeDataset(request("fr", null)));
        verify(reviewService, never()).analyzeFacts(anyString(), anyInt(), any(AllowedLanguage.class), any());
    }

    @Test
    void invalidCorrelationIdRejectedBeforeStreamStarts() throws Exception {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyzeDataset(request("zh", "not-a-uuid")));
        verify(reviewService, never()).analyzeFacts(anyString(), anyInt(), any(AllowedLanguage.class), any());
    }

    @Test
    void datasetDoneEventCarriesAnalysisTextAndDisclaimer() throws Exception {
        doReturn(new AnalyzeResponse("team review"))
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        final String body = drainUntilMarker(analyzeDirect("zh"), "event:done");

        assertTrue(body.contains("event:done"), body);
        assertTrue(body.contains("\"analysis\":\"team review"),
                "controller 原样转发 reviewService 的 analysis（disclaimer 由 service 负责）: " + body);
    }

    @Test
    void langEnIsForwardedToReviewService() throws Exception {
        doReturn(new AnalyzeResponse("ok"))
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());
        drainUntilMarker(analyzeDirect("en"), "event:done");
        verify(reviewService).analyzeFacts(eq("p1"), eq(0), eq(AllowedLanguage.EN), any());
    }

    @Test
    void langRuIsForwardedToReviewService() throws Exception {
        doReturn(new AnalyzeResponse("ok"))
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());
        drainUntilMarker(analyzeDirect("ru"), "event:done");
        verify(reviewService).analyzeFacts(eq("p1"), eq(0), eq(AllowedLanguage.RU), any());
    }

    @Test
    void unresolvedPerspectiveConveysStableErrorEvent() throws Exception {
        doThrow(new PerspectiveTeamNotResolvedException("PERSPECTIVE_TEAM_UNRESOLVED"))
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        final String body = analyzeConveyingError("zh");
        assertTrue(body.contains("\"code\":\"PERSPECTIVE_TEAM_UNRESOLVED\""), body);
    }

    @Test
    void mixedScopesConveysStableErrorEvent() throws Exception {
        doThrow(new MixedAnalysisScopesException("MIXED_ANALYSIS_SCOPES"))
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        final String body = analyzeConveyingError("zh");
        assertTrue(body.contains("\"code\":\"MIXED_ANALYSIS_SCOPES\""), body);
    }

    @Test
    void promptBudgetExceededConveysStableErrorEvent() throws Exception {
        doThrow(new AiPromptBudgetExceededException())
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        final String body = analyzeConveyingError("zh");
        assertTrue(body.contains("\"code\":\"AI_PROMPT_MANDATORY_SECTION_TOO_LARGE\""), body);
    }

    @Test
    void missingAiConfigurationConveysStableErrorEvent() throws Exception {
        doThrow(new AiNotConfiguredException())
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        final String body = analyzeConveyingError("zh");
        assertTrue(body.contains("\"code\":\"AI_NOT_CONFIGURED\""), body);
    }

    @Test
    void upstreamFailureConveysOnlyStableCode() throws Exception {
        doThrow(new AiUpstreamException("AI_RATE_LIMITED", 429, "private-correlation-id"))
                .when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        final String body = analyzeConveyingError("zh");
        assertTrue(body.contains("\"code\":\"AI_RATE_LIMITED\""), body);
        assertTrue(!body.contains("private-correlation-id"), "upstream detail must not leak: " + body);
    }

    // ---- helpers ----

    private ReconstructionController.AnalyzeDatasetRequest request(final String lang, final String correlationId) {
        return new ReconstructionController.AnalyzeDatasetRequest("p1", "r0", lang, correlationId);
    }

    private ReconstructionControllerStreamingTest.RecordingEmitter analyzeDirect(final String lang) {
        final ReconstructionControllerStreamingTest.RecordingEmitter emitter =
                new ReconstructionControllerStreamingTest.RecordingEmitter(ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(emitter).when(controllerSpy).newAnalyzeEmitter();
        controllerSpy.analyzeDataset(request(lang, "00000000-0000-0000-0000-0000000000ab"));
        return emitter;
    }

    /** 断言 worker 通过 error 事件传达稳定错误码（而非 HTTP 状态码）。 */
    private String analyzeConveyingError(final String lang) throws InterruptedException {
        final String body = drainUntilMarker(analyzeDirect(lang), "event:error");
        assertTrue(body.contains("event:error"), body);
        assertTrue(!body.contains("event:done"), "failed stream must not emit done: " + body);
        return body;
    }

    /** 轮询事件队列直到包含 marker（或超时），返回已收集的事件文本。 */
    private String drainUntilMarker(final ReconstructionControllerStreamingTest.RecordingEmitter emitter,
                                    final String marker) throws InterruptedException {
        final StringBuilder body = new StringBuilder();
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            final String event = emitter.awaitEvent(
                    Math.max(1, (deadline - System.nanoTime()) / 1_000_000),
                    TimeUnit.MILLISECONDS);
            if (event == null) {
                break;
            }
            body.append(event);
            if (event.contains(marker)) {
                break;
            }
        }
        return body.toString();
    }

    /** 断言给定参数组合触发稳定 410（multipart 已废弃，防御性契约）。 */
    @Test
    void legacyMultipartAnalyzeReturnsGone() {
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> controller.analyze(new org.springframework.mock.web.MockMultipartFile[0], "zh", null));
        assertEquals(org.springframework.http.HttpStatus.GONE, e.getStatusCode());
    }
}
