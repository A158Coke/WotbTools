package com.wotb.web.replay.controller;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * {@code /api/replay/analyze} SSE 流式契约测试：阶段事件序列
 * （call1_start/call1_done/evidence_done/call2_token/autopsy/error/done）、
 * done 事件携带 analysis + preBattleSection 双字段、客户端断开时触发取消、
 * 流中途失败走 error 事件。
 */
class ReconstructionControllerStreamingTest {

    private DefaultReplayProcessingFacade processingFacade;
    private AiReplayAnalysisService aiService;
    private AiReplayReviewService reviewService;
    private AiCancellationRegistry cancellationRegistry;
    private MockMvc mvc;
    private ReconstructionController controller;

    @BeforeEach
    void setUp() {
        processingFacade = mock(DefaultReplayProcessingFacade.class);
        aiService = mock(AiReplayAnalysisService.class);
        reviewService = spy(new AiReplayReviewService(processingFacade, aiService));
        cancellationRegistry = spy(new AiCancellationRegistry());
        controller = new ReconstructionController(
                processingFacade, reviewService, cancellationRegistry);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void emitsFullStageSequenceAndDoneWithBothContractFields() throws Exception {
        final String body = analyzeWithEvents(listener -> {
            listener.onStage("call1_start");
            listener.onStage("call1_done");
            listener.onStage("evidence_done");
            listener.onToken("hello ");
            listener.onToken("world");
        });

        assertTrue(body.contains("event:call1_start"), body);
        assertTrue(body.contains("event:call1_done"), body);
        assertTrue(body.contains("event:evidence_done"), body);
        assertTrue(body.contains("event:call2_token"), body);
        assertTrue(body.contains("\"delta\":\"hello \""), body);
        assertTrue(body.contains("\"delta\":\"world\""), body);
        // done 事件携带阶段 3 双字段契约：analysis + preBattleSection
        assertTrue(body.contains("event:done"), body);
        assertTrue(body.contains("\"analysis\":\"full analysis\""), body);
        assertTrue(body.contains("\"preBattleSection\":\"## 赛前预测\""), body);
    }

    @Test
    void autopsyEventsAreForwardedBeforeDone() throws Exception {
        final String body = analyzeWithEvents(listener -> {
            listener.onStage("call1_start");
            listener.onStage("call1_done");
            listener.onToken("team review");
            listener.onStage("autopsy_start");
            listener.onStage("autopsy_done");
        });

        assertTrue(body.indexOf("event:autopsy_start") < body.indexOf("event:autopsy_done"), body);
        assertTrue(body.indexOf("event:autopsy_done") < body.indexOf("event:done"), body);
        assertTrue(body.contains("event:call2_token"), body);
    }

    @Test
    void clientDisconnectCancelsInFlightRequest() throws Exception {
        // SSE 写入在第二次 send 时失败（模拟客户端断开）。
        final SseEmitter flaky = new SseEmitter(420_000L) {
            private int sends;

            @Override
            public void send(final SseEmitter.SseEventBuilder builder) throws IOException {
                if (++sends >= 2) {
                    throw new IOException("client gone");
                }
                super.send(builder);
            }
        };
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(flaky).when(controllerSpy).newAnalyzeEmitter();
        final MockMvc spyMvc = MockMvcBuilders.standaloneSetup(controllerSpy).build();

        final ArgumentCaptor<String> idCaptor = ArgumentCaptor.forClass(String.class);
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            // 第二次 send 抛 IOException → 控制器应取消该 correlationId 的上游调用。
            listener.onToken("boom");
            return new AnalyzeResponse("x", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final MvcResult result = spyMvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("stream.wotbreplay")))
                .andExpect(request().asyncStarted())
                .andReturn();
        spyMvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andReturn();

        verify(cancellationRegistry, org.mockito.Mockito.atLeastOnce()).cancel(idCaptor.capture());
        assertTrue(idCaptor.getAllValues().stream().anyMatch(id -> id != null && !id.isBlank()),
                "client disconnect must cancel the in-flight correlation id");
    }

    @Test
    void midStreamFailureIsConveyedAsErrorEvent() throws Exception {
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            listener.onStage("call1_done");
            listener.onToken("partial");
            throw new AiUpstreamException("AI_RATE_LIMITED", 429, "corr-stream");
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final MvcResult result = mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("stream.wotbreplay")))
                .andExpect(request().asyncStarted())
                .andReturn();
        final String body = mvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // 已发送事件：错误以 error 事件传达稳定码，而非 HTTP 502。
        assertTrue(body.contains("event:call1_start"), body);
        assertTrue(body.contains("event:error"), body);
        assertTrue(body.contains("\"code\":\"AI_RATE_LIMITED\""), body);
        assertTrue(!body.contains("event:done"), "failed stream must not emit done");
    }

    @Test
    void preStreamFailureKeepsStableHttpErrorMapping() throws Exception {
        // 未发送任何事件时失败：交给 @ExceptionHandler → 稳定 502。
        doAnswer(invocation -> {
            throw new AiUpstreamException("AI_UPSTREAM_UNAVAILABLE", 500, "corr-stream");
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("stream.wotbreplay")))
                .andExpect(status().isBadGateway());
    }

    @Test
    void unknownLocaleFailsBeforeStreamStarts() throws Exception {
        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "xx")
                        .file(replayFile("stream.wotbreplay")))
                .andExpect(status().isBadRequest());
        verify(reviewService, org.mockito.Mockito.never())
                .analyzeStreaming(any(), any(), any());
    }

    /**
     * 单请求流式断言：stub analyzeStreaming 在 doAnswer 内驱动事件序列，
     * 返回后由 done 事件收尾；返回 SSE 响应体文本。
     */
    private String analyzeWithEvents(final EventDriver driver) throws Exception {
        final ArgumentCaptor<AiReviewStreamListener> captor =
                ArgumentCaptor.forClass(AiReviewStreamListener.class);
        doAnswer(invocation -> {
            driver.drive(invocation.getArgument(2));
            return new AnalyzeResponse("full analysis", "## 赛前预测");
        }).when(reviewService).analyzeStreaming(any(), any(), captor.capture());

        final MvcResult result = mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("stream.wotbreplay")))
                .andExpect(request().asyncStarted())
                .andReturn();
        final MvcResult dispatched = mvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .content().contentType("text/event-stream"))
                .andReturn();
        final byte[] bytes = dispatched.getResponse().getContentAsByteArray();
        return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
    }

    @FunctionalInterface
    private interface EventDriver {
        void drive(AiReviewStreamListener listener);
    }

    private static MockMultipartFile replayFile(final String fileName) {
        return new MockMultipartFile(
                "files", fileName, "application/octet-stream", new byte[]{1});
    }
}
