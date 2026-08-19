package com.wotb.web.replay.controller;

import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.timeline.TimelineError;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR #102 review P0：{@code AiTimelineUnusableException} 的 SSE error 契约。
 * <p>真实 boundary 测试（非 Mockito）：构造真实 {@link ReconstructionController} +
 * 真实 {@link AiReviewWorkerExecutor} + 收集事件的 {@code RecordingEmitter}，
 * worker 内抛出带 {@link TimelineError} detail 的 {@code AiTimelineUnusableException}，
 * 捕获实际写入的 SSE error 事件，断言客户端 code <b>严格等于</b>
 * {@code AI_TIMELINE_UNUSABLE}、不含 {@code :}、不含任何 {@code TIMELINE_*} 内部
 * validation 码；validation detail 只允许留在后端日志，绝不进入稳定协议。</p>
 */
class ReconstructionControllerTimelineUnusableTest {

    private static final Pattern CODE_PATTERN = Pattern.compile("\"code\"\\s*:\\s*\"([^\"]+)\"");

    private AiReviewWorkerExecutor workerExecutor;
    private AiCancellationRegistry cancellationRegistry;
    private DefaultReplayProcessingFacade facade;

    @BeforeEach
    void setUp() {
        facade = new DefaultReplayProcessingFacade();
        cancellationRegistry = new AiCancellationRegistry();
        workerExecutor = new AiReviewWorkerExecutor();
    }

    @AfterEach
    void tearDown() {
        workerExecutor.close();
    }

    @Test
    void timelineUnusableSseErrorEventCarriesOnlyStableCode_validationDetailNeverLeaks() throws Exception {
        final TestableController controller = controllerWith(new ThrowingReviewService(
                List.of(TimelineError.TIMELINE_CLOCK_UNRESOLVED, TimelineError.TIMELINE_META_INVALID)));
        controller.analyze(replayFiles(), "zh", UUID.randomUUID().toString());

        final String errorEvent = awaitErrorEvent(controller.emitter);
        // 1) 客户端 code EXACTLY == 稳定码
        assertEquals("AI_TIMELINE_UNUSABLE", extractCode(errorEvent), errorEvent);
        // 2) 不含 ":"（detail 分隔符）
        assertFalse(extractCode(errorEvent).contains(":"), errorEvent);
        // 3) 不含任何 TimelineError 内部 validation 码（稳定码 AI_TIMELINE_UNUSABLE
        //    自身含 "TIMELINE_"，故按枚举名逐一断言，而非子串）。
        assertNoInternalValidationCodes(errorEvent);
        // 4) 完整事件载荷也不得泄露 NO_RECONSTRUCTION 等 detail
        assertFalse(errorEvent.contains("NO_RECONSTRUCTION"), errorEvent);
        assertFalse(errorEvent.contains("event:done"), "failed stream must not emit done");
    }

    @Test
    void timelineUnusableNoReconstructionVariantAlsoYieldsStableCode() throws Exception {
        // NO_RECONSTRUCTION 变体（无 reconstruction 拒绝）同样只传稳定码
        final TestableController controller = controllerWith(new ThrowingReviewService("NO_RECONSTRUCTION"));
        controller.analyze(replayFiles(), "zh", UUID.randomUUID().toString());

        final String errorEvent = awaitErrorEvent(controller.emitter);
        assertEquals("AI_TIMELINE_UNUSABLE", extractCode(errorEvent), errorEvent);
        assertFalse(errorEvent.contains("NO_RECONSTRUCTION"), errorEvent);
        assertNoInternalValidationCodes(errorEvent);
    }

    @Test
    void errorCodeOfReturnsExactlyStableCodeForBothConstructors() {
        final AiTimelineUnusableException listVariant = new AiTimelineUnusableException(
                List.of(TimelineError.TIMELINE_CLOCK_UNRESOLVED, TimelineError.TIMELINE_META_INVALID));
        final String code = ReconstructionController.errorCodeOf(listVariant);
        assertEquals("AI_TIMELINE_UNUSABLE", code);
        assertFalse(code.contains(":"), "SSE stable code must not carry detail separator");
        assertNoInternalValidationCodes(code);

        final String detailCode = ReconstructionController.errorCodeOf(
                new AiTimelineUnusableException("NO_RECONSTRUCTION"));
        assertEquals("AI_TIMELINE_UNUSABLE", detailCode);
        assertFalse(detailCode.contains("NO_RECONSTRUCTION"), "detail must stay backend-only");

        // 同步 HTTP 路径（GlobalExceptionHandler 冒号前前缀提取）契约：
        // message 冒号前必须 == 稳定码（构造函数保证单一来源，不漂移）。
        final String message = listVariant.getMessage();
        assertEquals("AI_TIMELINE_UNUSABLE", message.substring(0, message.indexOf(':')));

        // 其余稳定码映射不受影响（防止本分支破坏既有 SSE 契约）。
        assertEquals("AI_RATE_LIMITED",
                ReconstructionController.errorCodeOf(new AiUpstreamException("AI_RATE_LIMITED", 429, "t")));
        assertEquals("AI_NOT_CONFIGURED", ReconstructionController.errorCodeOf(new AiNotConfiguredException()));
    }

    // ---- helpers ----

    private TestableController controllerWith(final ThrowingReviewService reviewService) {
        return new TestableController(facade, reviewService, cancellationRegistry, workerExecutor);
    }

    private static String awaitErrorEvent(final ReconstructionControllerStreamingTest.RecordingEmitter emitter)
            throws InterruptedException {
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        final StringBuilder body = new StringBuilder();
        while (System.nanoTime() < deadline) {
            final String event = emitter.awaitEvent(
                    Math.max(1, (deadline - System.nanoTime()) / 1_000_000),
                    TimeUnit.MILLISECONDS);
            if (event == null) {
                break;
            }
            body.append(event);
            if (event.contains("event:error") || event.contains("event:done")) {
                break;
            }
        }
        final String payload = body.toString();
        assertTrue(payload.contains("event:error"),
                "expected SSE error event, got: " + payload);
        return payload;
    }

    private static String extractCode(final String payload) {
        final Matcher m = CODE_PATTERN.matcher(payload);
        assertTrue(m.find(), "no \"code\" field in error event payload: " + payload);
        return m.group(1);
    }

    /**
     * 断言文本不含任何 TimelineError 内部 validation 码（stable 码自身含 TIMELINE_ 子串）。
     */
    private static void assertNoInternalValidationCodes(final String text) {
        for (final TimelineError error : TimelineError.values()) {
            assertFalse(text.contains(error.name()),
                    "internal validation code leaked into client contract: " + error.name());
        }
    }

    private static MultipartFile[] replayFiles() {
        return new MultipartFile[]{new MockMultipartFile(
                "files", "stream.wotbreplay", "application/octet-stream", new byte[]{1})};
    }

    /**
     * 真实 controller 子类：注入收集事件的 emitter（替代 Mockito spy）。
     */
    private static final class TestableController extends ReconstructionController {
        final ReconstructionControllerStreamingTest.RecordingEmitter emitter;

        TestableController(final DefaultReplayProcessingFacade facade,
                           final AiReplayReviewService reviewService,
                           final AiCancellationRegistry cancellationRegistry,
                           final AiReviewWorkerExecutor workerExecutor) {
            super(facade, reviewService, cancellationRegistry, workerExecutor,
                    new MapOverviewQueryService(facade), null);
            emitter = new ReconstructionControllerStreamingTest.RecordingEmitter(
                    ReconstructionController.SSE_TIMEOUT_MS);
        }

        @Override
        SseEmitter newAnalyzeEmitter() {
            return emitter;
        }
    }

    /**
     * 抛 {@code AiTimelineUnusableException} 的假 review service（不依赖 Mockito）。
     */
    private static final class ThrowingReviewService extends AiReplayReviewService {
        private final RuntimeException failure;

        ThrowingReviewService(final List<TimelineError> errors) {
            this(new AiTimelineUnusableException(errors));
        }

        ThrowingReviewService(final String detail) {
            this(new AiTimelineUnusableException(detail));
        }

        private ThrowingReviewService(final RuntimeException failure) {
            super(null, null);
            this.failure = failure;
        }

        @Override
        public AnalyzeResponse analyzeStreaming(final MultipartFile[] files,
                                                final AllowedLanguage language,
                                                final AiReviewStreamListener listener) {
            throw failure;
        }
    }
}
