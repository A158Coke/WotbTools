package com.wotb.web.replay.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * （blocker 2）：AI Review worker 生命周期<b>终态 exactly once</b>——
 * 每个真正开始执行的 worker 请求恰好产生一次 {@code event=ai_review_finished}，
 * result ∈ {SUCCESS, FAILED, CANCELLED}（FAILED 带稳定 errorCode，CANCELLED 带稳定 source）。
 * <p>用 logback {@link ListAppender} 捕获 {@code ReconstructionController} 日志并<b>计数</b>
 * 终态出现次数（而非仅断言某条日志存在），覆盖 success / RuntimeException / SSE disconnect /
 * queued cancellation 四路径；correlationId 全程保持同一 requestId。</p>
 */
class ReconstructionControllerLifecycleLogTest {

    private static final String ID_SUCCESS = "00000000-0000-0000-0000-0000000000a1";
    private static final String ID_FAILED = "00000000-0000-0000-0000-0000000000b1";
    private static final String ID_DISCONNECT = "00000000-0000-0000-0000-0000000000d1";
    private static final String ID_QUEUED_1 = "00000000-0000-0000-0000-0000000000c1";
    private static final String ID_QUEUED_2 = "00000000-0000-0000-0000-0000000000c2";

    private AiReplayAnalysisService aiService;
    private AiReplayReviewService reviewService;
    private AiCancellationRegistry cancellationRegistry;
    private AiReviewWorkerExecutor workerExecutor;
    private ReconstructionController controller;
    private Logger controllerLogger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void setUp() {
        aiService = mock(AiReplayAnalysisService.class);
        reviewService = spy(new AiReplayReviewService(aiService, null, null, null));
        cancellationRegistry = spy(new AiCancellationRegistry());
        workerExecutor = new AiReviewWorkerExecutor();
        controller = new ReconstructionController(reviewService, cancellationRegistry,
                workerExecutor, new MapOverviewQueryService(null));
        controllerLogger = (Logger) LoggerFactory.getLogger(ReconstructionController.class);
        appender = new ListAppender<>();
        // ListAppender.list 默认是普通 ArrayList，append() 无同步：worker 线程并发写
        // （runAnalysis 在 wotb-ai-review-worker-N 上运行）而测试线程 awaitLogContaining()
        // 轮询 stream() 时会抛 ConcurrentModificationException。本测试写入量小、轮询读多，
        // CopyOnWriteArrayList 使并发 add 与迭代都安全，且不改变 lifecycle 语义。
        appender.list = new CopyOnWriteArrayList<>();
        appender.start();
        controllerLogger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        controllerLogger.detachAppender(appender);
        workerExecutor.close();
    }

    @Test
    void successLifecycleEmitsFinishedExactlyOnce() throws Exception {
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(3);
            listener.onStage("call1_start");
            listener.onToken("draft");
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        analyzeDirect(controller, ID_SUCCESS);
        final String all = awaitLogContaining(ID_SUCCESS, "event=ai_review_finished");

        assertEquals(1, countFinished(all, ID_SUCCESS),
                "success 路径必须恰好一次 ai_review_finished: " + all);
        assertTrue(all.contains("event=ai_review_finished correlationId=" + ID_SUCCESS + " result=SUCCESS"),
                "终态 result=SUCCESS: " + all);
        assertTrue(all.contains("event=ai_review_sse_completed correlationId=" + ID_SUCCESS),
                "SSE 完成事件保留: " + all);
        assertTrue(!all.contains("event=ai_review_failed"), "成功路径不得出现 ai_review_failed: " + all);
        assertTrue(!all.contains("event=ai_review_cancelled"), "成功路径不得出现 ai_review_cancelled: " + all);
    }

    @Test
    void failureLifecycleEmitsFinishedExactlyOnceWithFailedResult() throws Exception {
        doAnswer(invocation -> {
            throw new AiUpstreamException("AI_RATE_LIMITED", 429, ID_FAILED);
        }).when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        analyzeDirect(controller, ID_FAILED);
        final String all = awaitLogContaining(ID_FAILED, "event=ai_review_finished");

        assertEquals(1, countFinished(all, ID_FAILED),
                "失败路径必须恰好一次 ai_review_finished: " + all);
        assertTrue(all.contains("event=ai_review_finished correlationId=" + ID_FAILED
                        + " result=FAILED errorCode=AI_RATE_LIMITED"),
                "终态 result=FAILED + 稳定 errorCode: " + all);
        assertTrue(all.contains("event=ai_review_failed correlationId=" + ID_FAILED
                        + " errorCode=AI_RATE_LIMITED"),
                "ai_review_failed 诊断事件保留: " + all);
    }

    @Test
    void sseDisconnectLifecycleEmitsFinishedExactlyOnceWithCancelledResult() throws Exception {
        final ReconstructionControllerStreamingTest.RecordingEmitter flaky =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS) {
                    private int sends;

                    @Override
                    public void send(final org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder builder) {
                        if (++sends >= 2) {
                            throw new IllegalStateException(new IOException("client gone"));
                        }
                        super.send(builder);
                    }
                };
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(flaky).when(controllerSpy).newAnalyzeEmitter();
        doAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(3);
            listener.onStage("call1_start");
            // 第二次 send 抛 IOException → worker 应以 SSE_DISCONNECT 取消并给出 CANCELLED 终态。
            listener.onToken("boom");
            return new AnalyzeResponse("x", null);
        }).when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        controllerSpy.analyzeDataset(datasetRequest(ID_DISCONNECT));
        final String all = awaitLogContaining(ID_DISCONNECT, "event=ai_review_finished");

        assertEquals(1, countFinished(all, ID_DISCONNECT),
                "SSE 断开路径必须恰好一次 ai_review_finished: " + all);
        assertTrue(all.contains("event=ai_review_finished correlationId=" + ID_DISCONNECT
                        + " result=CANCELLED source=SSE_DISCONNECT"),
                "终态 result=CANCELLED source=SSE_DISCONNECT: " + all);
        assertTrue(all.contains("event=ai_review_cancelled correlationId=" + ID_DISCONNECT
                        + " source=SSE_DISCONNECT"),
                "ai_review_cancelled 诊断事件保留: " + all);
    }

    @Test
    void queuedCancellationLifecycleEmitsFinishedExactlyOnceWithCancelledResult() throws Exception {
        // 单 worker：第一个请求占住 worker，第二个请求排队 → 排队期间被取消 → 拾取时走 CANCELLED_WHILE_QUEUED。
        workerExecutor = new AiReviewWorkerExecutor(1, 4);
        controller = new ReconstructionController(reviewService, cancellationRegistry,
                workerExecutor, new MapOverviewQueryService(null));
        final CountDownLatch firstStarted = new CountDownLatch(1);
        final CountDownLatch releaseFirst = new CountDownLatch(1);
        doAnswer(invocation -> {
            firstStarted.countDown();
            releaseFirst.await(10, TimeUnit.SECONDS);
            return new AnalyzeResponse("full", null);
        }).when(reviewService).analyzeFacts(eq("p1"), eq(0), any(AllowedLanguage.class), any());

        analyzeDirect(controller, ID_QUEUED_1);
        assertTrue(firstStarted.await(5, TimeUnit.SECONDS),
                "第一个 worker 必须先启动并阻塞");
        analyzeDirect(controller, ID_QUEUED_2);
        // 排队期间取消：worker 拾取时 isCancelled() → CANCELLED_WHILE_QUEUED 终态。
        assertTrue(cancellationRegistry.cancel(ID_QUEUED_2), "排队中的请求必须可被取消");
        releaseFirst.countDown();

        final String all = awaitLogContaining(ID_QUEUED_2, "event=ai_review_finished");
        assertEquals(1, countFinished(all, ID_QUEUED_2),
                "queued cancellation 路径必须恰好一次 ai_review_finished: " + all);
        assertTrue(all.contains("event=ai_review_finished correlationId=" + ID_QUEUED_2
                        + " result=CANCELLED source=CANCELLED_WHILE_QUEUED"),
                "终态 result=CANCELLED source=CANCELLED_WHILE_QUEUED: " + all);
        assertTrue(all.contains("event=ai_review_cancelled correlationId=" + ID_QUEUED_2
                        + " source=CANCELLED_WHILE_QUEUED"),
                "ai_review_cancelled 诊断事件保留: " + all);
        // 第一个请求仍正常 SUCCESS（互不干扰，各自 exactly once）。
        assertEquals(1, countFinished(all, ID_QUEUED_1),
                "第一个请求仍恰好一次 ai_review_finished: " + all);
        assertTrue(all.contains("event=ai_review_finished correlationId=" + ID_QUEUED_1 + " result=SUCCESS"),
                "第一个请求终态 result=SUCCESS: " + all);
    }

    // ---- helpers ----

    private static ReconstructionController.AnalyzeDatasetRequest datasetRequest(final String correlationId) {
        return new ReconstructionController.AnalyzeDatasetRequest("p1", "r0", "zh", correlationId);
    }

    private ReconstructionControllerStreamingTest.RecordingEmitter analyzeDirect(
            final ReconstructionController target, final String correlationId) {
        final ReconstructionControllerStreamingTest.RecordingEmitter emitter =
                new ReconstructionControllerStreamingTest.RecordingEmitter(
                        ReconstructionController.SSE_TIMEOUT_MS);
        final ReconstructionController controllerSpy = spy(target);
        doReturn(emitter).when(controllerSpy).newAnalyzeEmitter();
        controllerSpy.analyzeDataset(datasetRequest(correlationId));
        return emitter;
    }

    private long countFinished(final String all, final String correlationId) {
        return Arrays.stream(all.split("\n"))
                .filter(line -> line.contains("event=ai_review_finished")
                        && line.contains("correlationId=" + correlationId))
                .count();
    }

    private String logs() {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .collect(Collectors.joining("\n"));
    }

    /** 等待某个 correlationId 的日志中出现 marker（如 event=ai_review_finished），返回全部日志。 */
    private String awaitLogContaining(final String correlationId, final String marker)
            throws InterruptedException {
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            final String all = logs();
            // marker 必须与 correlationId 出现在同一行：全局 contains 会被其他请求的
            // 同 marker 日志提前满足（如 c1 的 ai_review_finished SUCCESS 抢先 c2），
            // 导致 countFinished(c2) == 0 的偶发失败。
            if (all.lines().anyMatch(line ->
                    line.contains("correlationId=" + correlationId) && line.contains(marker))) {
                return all;
            }
            Thread.sleep(20);
        }
        final String all = logs();
        assertNotNull(all, "等待日志超时");
        return all;
    }
}
