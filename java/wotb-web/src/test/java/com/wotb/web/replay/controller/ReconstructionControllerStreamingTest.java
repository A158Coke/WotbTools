package com.wotb.web.replay.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

/**
 * {@code /api/replay/analyze} SSE 流式契约测试（真实异步 worker）：
 * <ul>
 *   <li>阶段事件序列（call1_start/call1_done/evidence_done/call2_token/autopsy/error/done）与
 *       done 双字段契约；</li>
 *   <li><b>真异步时序</b>：第一条 SSE 事件在 AI 分析完成前到达、request 线程不被完整
 *       AI 调用占住、cancel 端点在流式期间可找到进行中请求；</li>
 *   <li><b>生命周期</b>：timeout/error/客户端断开驱动 cancellation，清理幂等；</li>
 *   <li>客户端断开 / 流中途失败 / worker 失败的事件传达语义。</li>
 * </ul>
 * <p>不依赖 MockMvc：直接调用 {@code controller.analyze(...)} 并用收集事件的
 * {@link RecordingEmitter} 验证 SSE 载荷，避免异步完成时序在 asyncDispatch 中不确定。</p>
 */
class ReconstructionControllerStreamingTest {

    private DefaultReplayProcessingFacade processingFacade;
    private AiReplayAnalysisService aiService;
    private AiReplayReviewService reviewService;
    private AiCancellationRegistry cancellationRegistry;
    private AiReviewWorkerExecutor workerExecutor;
    private ReconstructionController controller;

    @BeforeEach
    void setUp() {
        processingFacade = mock(DefaultReplayProcessingFacade.class);
        aiService = mock(AiReplayAnalysisService.class);
        reviewService = spy(new AiReplayReviewService(processingFacade, aiService));
        cancellationRegistry = spy(new AiCancellationRegistry());
        workerExecutor = new AiReviewWorkerExecutor();
        controller = new ReconstructionController(processingFacade, reviewService, cancellationRegistry, workerExecutor, new MapOverviewQueryService(processingFacade), null);
    }

    @AfterEach
    void tearDown() {
        workerExecutor.close();
    }

    @Test
    void emitsFullStageSequenceAndDoneWithBothContractFields() throws Exception {
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            listener.onStage("call1_done");
            listener.onStage("evidence_done");
            listener.onToken("hello ");
            listener.onToken("world");
            return new AnalyzeResponse("full analysis", "## 赛前预测",
                    new com.wotb.web.replay.dto.MapOverview(
                            "desert_train", "Desert Sands",
                            Map.of("zh", "黄沙荒漠", "en", "Desert Sands", "ru", "Пустынные пески"),
                            2,
                            new com.wotb.web.replay.dto.MapOverview.Bounds(-256, 260, -251, 254.3),
                            List.of(), null, List.of(), List.of(), null, List.of(),
                            null, null, null));
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final String body = drainUntilTerminal(analyzeDirect("zh", null));

        assertTrue(body.contains("event:call1_start"), body);
        assertTrue(body.contains("event:call1_done"), body);
        assertTrue(body.contains("event:evidence_done"), body);
        assertTrue(body.contains("event:call2_token"), body);
        assertTrue(body.contains("\"delta\":\"hello \""), body);
        assertTrue(body.contains("\"delta\":\"world\""), body);
        assertTrue(body.contains("event:done"), body);
        assertTrue(body.contains("\"analysis\":\"full analysis\""), body);
        assertTrue(body.contains("\"preBattleSection\":\"## 赛前预测\""), body);
        assertTrue(body.contains("\"mapOverview\":{\"mapCode\":\"desert_train\""), body);
    }

    @Test
    void autopsyEventsAreForwardedBeforeDone() throws Exception {
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            listener.onStage("call1_done");
            listener.onToken("team review");
            listener.onStage("autopsy_start");
            listener.onStage("autopsy_done");
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final String body = drainUntilTerminal(analyzeDirect("zh", null));

        assertTrue(body.indexOf("event:autopsy_start") < body.indexOf("event:autopsy_done"), body);
        assertTrue(body.indexOf("event:autopsy_done") < body.indexOf("event:done"), body);
        assertTrue(body.contains("event:call2_token"), body);
    }

    @Test
    void clientDisconnectCancelsInFlightRequest() throws Exception {
        // SSE 写入在第二次 send 时失败（模拟客户端断开）。
        final RecordingEmitter flaky = new RecordingEmitter(ReconstructionController.SSE_TIMEOUT_MS) {
            private int sends;

            @Override
            public void send(final SseEventBuilder builder) {
                if (++sends >= 2) {
                    throw new IllegalStateException(new IOException("client gone"));
                }
                super.send(builder);
            }
        };
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(flaky).when(controllerSpy).newAnalyzeEmitter();
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            // 第二次 send 抛 IOException → worker 应取消该 correlationId 的上游调用。
            listener.onToken("boom");
            return new AnalyzeResponse("x", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        controllerSpy.analyze(replayFiles(), "zh", "00000000-0000-0000-0000-000000000004");

        verify(cancellationRegistry, timeout(5000)).cancel("00000000-0000-0000-0000-000000000004");
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

        final String body = drainUntilTerminal(analyzeDirect("zh", "00000000-0000-0000-0000-000000000016"));

        // 已发送事件：错误以 error 事件传达稳定码，done 不出现。
        assertTrue(body.contains("event:call1_start"), body);
        assertTrue(body.contains("event:error"), body);
        assertTrue(body.contains("\"code\":\"AI_RATE_LIMITED\""), body);
        assertFalse(body.contains("event:done"), "failed stream must not emit done");
    }

    @Test
    void workerFailureWithoutAnyEventIsStillConveyedAsErrorEvent() throws Exception {
        // 异步化后失败统一走 error 事件（HTTP 已 200 + SseEmitter），
        // 未发送任何事件时的校验失败也以稳定码传达，不再映射为 HTTP 状态码。
        doAnswer(invocation -> {
            throw new AiUpstreamException("AI_UPSTREAM_UNAVAILABLE", 500, "corr-stream");
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final String body = drainUntilTerminal(analyzeDirect("zh", "00000000-0000-0000-0000-000000000017"));

        assertTrue(body.contains("event:error"), body);
        assertTrue(body.contains("\"code\":\"AI_UPSTREAM_UNAVAILABLE\""), body);
        assertFalse(body.contains("event:done"), "failed stream must not emit done");
    }

    @Test
    void unknownLocaleFailsBeforeStreamStarts() throws Exception {
        // 白名单校验在 request 线程同步执行：直接抛 IllegalArgumentException（400 语义保留）。
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyze(replayFiles(), "xx", null));
        verify(reviewService, never()).analyzeStreaming(any(), any(), any());
    }

    @Test
    void returnsEmitterBeforeAnalysisCompletesAndFirstStageEventArrivesEarly() throws Exception {
        final CountDownLatch release = new CountDownLatch(1);
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            release.await(10, TimeUnit.SECONDS);
            listener.onToken("late-token");
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final long startNanos = System.nanoTime();
        final RecordingEmitter emitter = analyzeDirect("zh", "00000000-0000-0000-0000-000000000001");
        final long returnMillis = (System.nanoTime() - startNanos) / 1_000_000;

        // 1) request 线程不被完整 AI 调用占住：分析仍在进行，controller 已返回。
        assertTrue(returnMillis < 2_000,
                "controller must return before analysis completes (took " + returnMillis + "ms)");
        // 2) 第一条 SSE 阶段事件在分析完成前真正到达。
        final String firstEvent = emitter.awaitEvent(5, TimeUnit.SECONDS);
        assertNotNull(firstEvent, "first SSE event must arrive before analysis completes");
        assertTrue(firstEvent.contains("event:call1_start"), firstEvent);
        assertTrue(release.getCount() > 0,
                "first event must arrive while the analysis is still in flight");

        // 3) cancel 端点在流式期间仍可找到并取消进行中的 request（#6/#7）。
        assertTrue(cancellationRegistry.cancel("00000000-0000-0000-0000-000000000001"),
                "cancel endpoint must find the in-flight request");

        // 4) 释放 latch 后：token 与 done 正常到达，完成语义不被取消破坏。
        release.countDown();
        final String tokenEvent = emitter.awaitEventContaining("call2_token", 5, TimeUnit.SECONDS);
        assertNotNull(tokenEvent, "token must arrive after the analysis finishes");
        assertTrue(tokenEvent.contains("late-token"), tokenEvent);
        final String doneEvent = emitter.awaitEventContaining("event:done", 5, TimeUnit.SECONDS);
        assertNotNull(doneEvent, "done must arrive after the analysis finishes");
        assertTrue(doneEvent.contains("\"analysis\":\"full\""), doneEvent);
    }

    @Test
    void cancellationIsUnregisteredOnlyAfterWorkerCompletes() throws Exception {
        final CountDownLatch workerStarted = new CountDownLatch(1);
        final CountDownLatch releaseWorker = new CountDownLatch(1);
        doAnswer(invocation -> {
            workerStarted.countDown();
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            // 保持 worker 处于 in-flight 状态，直到主线程完成 cancel 断言，
            // 避免 worker 提前完成并在 finally 中 unregister 造成竞态。
            releaseWorker.await(10, TimeUnit.SECONDS);
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final RecordingEmitter emitter = analyzeDirect("zh", "00000000-0000-0000-0000-000000000002");
        // 等待 worker 真正启动（通过 worker-entry cancellation check）再 cancel。
        assertTrue(workerStarted.await(5, TimeUnit.SECONDS),
                "worker must start before cancel to test unregister-after-completion");
        // 流式进行中（worker 尚未结束）：cancel 端点必须能找到 request。
        assertTrue(cancellationRegistry.cancel("00000000-0000-0000-0000-000000000002"),
                "request must stay registered while the worker is running");
        releaseWorker.countDown();

        final String doneEvent = emitter.awaitEventContaining("event:done", 5, TimeUnit.SECONDS);
        assertNotNull(doneEvent, "done must arrive");
        // worker 真正结束后才 unregister（在 finally 中）。
        verify(cancellationRegistry, timeout(5000)).unregister(eq("00000000-0000-0000-0000-000000000002"), any());
    }

    @Test
    void emitterTimeoutCancelsInFlightRequest() throws Exception {
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final AtomicReference<Runnable> timeoutCallback = new AtomicReference<>();
        final RecordingEmitter emitter = new RecordingEmitter(ReconstructionController.SSE_TIMEOUT_MS);
        final RecordingEmitter spyEmitter = spy(emitter);
        doAnswer(invocation -> {
            timeoutCallback.set(invocation.getArgument(0));
            return null;
        }).when(spyEmitter).onTimeout(any(Runnable.class));
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(spyEmitter).when(controllerSpy).newAnalyzeEmitter();

        controllerSpy.analyze(replayFiles(), "zh", "00000000-0000-0000-0000-000000000005");

        final Runnable callback = timeoutCallback.get();
        assertNotNull(callback, "onTimeout callback must be registered");
        callback.run();
        verify(cancellationRegistry, timeout(5000)).cancel("00000000-0000-0000-0000-000000000005");
    }

    @Test
    void emitterErrorCancelsInFlightRequest() throws Exception {
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final AtomicReference<java.util.function.Consumer<Throwable>> errorCallback = new AtomicReference<>();
        final RecordingEmitter emitter = new RecordingEmitter(ReconstructionController.SSE_TIMEOUT_MS);
        final RecordingEmitter spyEmitter = spy(emitter);
        doAnswer(invocation -> {
            errorCallback.set(invocation.getArgument(0));
            return null;
        }).when(spyEmitter).onError(any());
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(spyEmitter).when(controllerSpy).newAnalyzeEmitter();

        controllerSpy.analyze(replayFiles(), "zh", "00000000-0000-0000-0000-000000000006");

        final java.util.function.Consumer<Throwable> callback = errorCallback.get();
        assertNotNull(callback, "onError callback must be registered");
        // 模拟客户端断开（AsyncClientDisconnectedException 语义）→ 驱动取消。
        callback.accept(new IOException("client gone"));
        verify(cancellationRegistry, timeout(5000)).cancel("00000000-0000-0000-0000-000000000006");
    }

    @Test
    void cancelEndpointLifecycleSemantics() throws Exception {
        final CountDownLatch release = new CountDownLatch(1);
        final CountDownLatch workerStarted = new CountDownLatch(1);
        doAnswer(invocation -> {
            workerStarted.countDown();
            release.await(10, TimeUnit.SECONDS);
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final RecordingEmitter emitter = analyzeDirect("zh", "00000000-0000-0000-0000-000000000007");
        // 等待 worker 真正启动（进入 analyzeStreaming，被 release latch 阻塞）再 cancel。
        assertTrue(workerStarted.await(5, TimeUnit.SECONDS),
                "worker must start and block before cancel");
        // 进行中：cancel 端点命中。
        assertEquals(204, controller.cancelAnalyze("00000000-0000-0000-0000-000000000007").getStatusCode().value());
        // 未注册的 id：404。
        assertEquals(404, controller.cancelAnalyze("00000000-0000-0000-0000-000000000008").getStatusCode().value());
        release.countDown();
        final String doneEvent = emitter.awaitEventContaining("event:done", 5, TimeUnit.SECONDS);
        assertNotNull(doneEvent, "cancelled-but-finished worker still completes the emitter");
    }

    @Test
    void concurrentCancellationAndCompletionIsIdempotent() throws Exception {
        final CountDownLatch workerStarted = new CountDownLatch(1);
        doAnswer(invocation -> {
            workerStarted.countDown();
            final AiReviewStreamListener listener = invocation.getArgument(2);
            listener.onStage("call1_start");
            listener.onToken("token");
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeStreaming(any(), any(), any());

        final RecordingEmitter emitter = analyzeDirect("zh", "00000000-0000-0000-0000-000000000003");
        // 等待 worker 真正启动（通过 worker-entry cancellation check）再 cancel。
        assertTrue(workerStarted.await(5, TimeUnit.SECONDS),
                "worker must start before cancel to test idempotent concurrent ops");

        // 模拟 cancel 端点 / SSE IOException / timeout 回调在正常完成前后同时发生：
        // 全部幂等，不抛异常。
        cancellationRegistry.cancel("00000000-0000-0000-0000-000000000003");
        cancellationRegistry.cancel("00000000-0000-0000-0000-000000000003");
        cancellationRegistry.unregister("00000000-0000-0000-0000-000000000003", null);

        final String body = drainUntilTerminal(emitter);
        assertTrue(body.contains("event:call2_token"), body);
        assertTrue(body.contains("event:done"), body);

        cancellationRegistry.unregister("00000000-0000-0000-0000-000000000003", null);
        verify(cancellationRegistry, timeout(5000).atLeastOnce()).cancel(anyString());
    }

    @Test
    void cancelEndpointOnUnregisteredRequestReturnsNotFound() {
        assertEquals(404, controller.cancelAnalyze("00000000-0000-0000-0000-000000000009").getStatusCode().value());
    }

    @Test
    void analyzeRejectsInvalidCorrelationId() {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyze(replayFiles(), "zh", "not-a-uuid"));
    }

    @Test
    void analyzeRejectsDuplicateCorrelationId() {
        final String id = "00000000-0000-0000-0000-0000000000cc";
        assertNotNull(cancellationRegistry.register(id));
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyze(replayFiles(), "zh", id));
    }

    @Test
    void cancelEndpointRejectsInvalidCorrelationId() {
        assertThrows(IllegalArgumentException.class,
                () -> controller.cancelAnalyze("not-a-uuid"));
    }

    @Test
    void analyzeRejectsMultipleFilesWithFileCountExceeded() {
        assertThrows(ReplayFileCountExceededException.class,
                () -> controller.analyze(replayFiles2(), "zh", null));
    }

    @Test
    void reconstructBatchAllowsMultipleFiles() throws Exception {
        // 文件数量不受 AI 单文件策略限制（B4 回归：通用校验不检查 MAX_FILES）
        controller.reconstructBatch(replayFiles2());
    }

    @Test
    void processAllowsMultipleFiles() throws Exception {
        controller.process(replayFiles2(), false);
    }

    @Test
    void genericUploadValidationErrorCodesAreStable() throws Exception {
        final IllegalArgumentException type = assertThrows(IllegalArgumentException.class,
                () -> controller.process(new MultipartFile[]{
                        new MockMultipartFile("files", "x.txt", "text/plain", new byte[]{1})}, false));
        assertEquals("INVALID_REPLAY_FILE_TYPE", type.getMessage());

        final IllegalArgumentException empty = assertThrows(IllegalArgumentException.class,
                () -> controller.process(new MultipartFile[]{
                        new MockMultipartFile("files", "empty.wotbreplay", "application/octet-stream", new byte[0])}, false));
        assertEquals("NO_REPLAY_FILE", empty.getMessage());

        final IllegalArgumentException tooLarge = assertThrows(IllegalArgumentException.class,
                () -> controller.process(new MultipartFile[]{
                        new MockMultipartFile("files", "big.wotbreplay", "application/octet-stream",
                                new byte[(int) ReplayUploadValidator.MAX_FILE_SIZE + 1])}, false));
        assertEquals("FILE_TOO_LARGE", tooLarge.getMessage());
    }

    // ---- helpers ----

    private RecordingEmitter analyzeDirect(final String lang, final String correlationId) {
        final RecordingEmitter emitter = new RecordingEmitter(ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(emitter).when(controllerSpy).newAnalyzeEmitter();
        controllerSpy.analyze(replayFiles(), lang, correlationId);
        return emitter;
    }

    /**
     * 轮询事件队列直到 done（成功流）或 error（失败流）终止事件，返回所有事件文本。
     */
    private String drainUntilTerminal(final RecordingEmitter emitter) throws InterruptedException {
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
            if (event.contains("event:done") || event.contains("event:error")) {
                break;
            }
        }
        assertTrue(body.toString().contains("event:done") || body.toString().contains("event:error"),
                "stream must complete with done or error: " + body);
        return body.toString();
    }

    private static MultipartFile[] replayFiles() {
        return new MultipartFile[]{new MockMultipartFile(
                "files", "stream.wotbreplay", "application/octet-stream", new byte[]{1})};
    }

    private static MultipartFile[] replayFiles2() {
        final MockMultipartFile file = new MockMultipartFile(
                "files", "stream.wotbreplay", "application/octet-stream", new byte[]{1});
        return new MultipartFile[]{file, file};
    }

    /**
     * 收集 SSE 事件的 SseEmitter（send 不写真实 response，仅入队）。
     */
    static class RecordingEmitter extends SseEmitter {

        private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

        private final BlockingQueue<String> events = new LinkedBlockingQueue<>();

        RecordingEmitter(final long timeout) {
            super(timeout);
        }

        @Override
        public void send(final SseEventBuilder builder) {
            final StringBuilder payload = new StringBuilder();
            for (final ResponseBodyEmitter.DataWithMediaType part : builder.build()) {
                final Object data = part.getData();
                if (data instanceof byte[] bytes) {
                    payload.append(new String(bytes, StandardCharsets.UTF_8));
                } else {
                    // 与真实 SseEmitter 一致：data 为对象时用 Jackson 序列化为 JSON。
                    try {
                        payload.append(OBJECT_MAPPER.writeValueAsString(data));
                    } catch (final JsonProcessingException e) {
                        throw new IllegalStateException(e);
                    }
                }
            }
            events.add(payload.toString());
        }

        String awaitEvent(final long timeout, final TimeUnit unit) throws InterruptedException {
            return events.poll(timeout, unit);
        }

        String awaitEventContaining(final String marker,
                                    final long timeout,
                                    final TimeUnit unit) throws InterruptedException {
            final long deadline = System.nanoTime() + unit.toNanos(timeout);
            while (System.nanoTime() < deadline) {
                final String event = events.poll(
                        Math.max(1, (deadline - System.nanoTime()) / 1_000_000),
                        TimeUnit.MILLISECONDS);
                if (event != null && event.contains(marker)) {
                    return event;
                }
            }
            return null;
        }
    }
}
