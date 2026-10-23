package com.wotb.ai.review.service;

import com.wotb.ai.gateway.AiCancellationToken;
import com.wotb.ai.gateway.AiRequestContext;
import com.wotb.ai.review.AiCancellationRegistry;
import com.wotb.ai.review.AiReviewDonePayload;
import com.wotb.ai.review.AiReviewRequest;
import com.wotb.ai.review.AiReviewStreamListener;
import com.wotb.ai.review.AllowedLanguage;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiReviewExecutionServiceTest {
    @Test
    void logsOneTerminalUsageSummaryAndClearsRequestContext() {
        final var logger = (ch.qos.logback.classic.Logger)
                org.slf4j.LoggerFactory.getLogger(AiReviewExecutionService.class);
        final var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        final AiReviewAnalysisService analysis = mock(AiReviewAnalysisService.class);
        when(analysis.analyze(any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            AiRequestContext.usageTotals().add(8, 2, 10, false);
            AiRequestContext.usageTotals().add(0, 0, 0, true);
            throw new IllegalStateException("private provider text");
        });
        final var execution = executionService(analysis);
        try {
            execution.execute(preparedReview(UUID.randomUUID().toString()), new SseEmitter());
            final var summaries = appender.list.stream().map(event -> event.getFormattedMessage())
                    .filter(message -> message.startsWith("event=ai_review_usage ")).toList();
            assertEquals(1, summaries.size());
            assertTrue(summaries.getFirst().contains("totalTokens=10 calls=2 missingUsageCalls=1 result=failure"));
            assertFalse(appender.list.stream()
                    .anyMatch(event -> event.getFormattedMessage().contains("private provider text")));
            assertNull(AiRequestContext.usageTotals());
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void emitsUnchangedStageTokenAndDoneEventNames() {
        final AiReviewAnalysisService analysis = mock(AiReviewAnalysisService.class);
        when(analysis.analyze(any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            final AiReviewStreamListener listener = invocation.getArgument(5);
            listener.onStage("call1_start");
            listener.onToken("delta");
            return new AiReviewDonePayload("analysis", null, AiReviewDonePayload.Capability.AVAILABLE,
                    null, List.of());
        });
        final RecordingEmitter emitter = new RecordingEmitter();
        executionService(analysis).execute(preparedReview(UUID.randomUUID().toString()), emitter);
        final List<String> wireFrames = emitter.events().stream()
                .map(event -> event.build().stream()
                        .map(ResponseBodyEmitter.DataWithMediaType::getData)
                        .map(String::valueOf)
                        .collect(Collectors.joining()))
                .toList();
        assertTrue(wireFrames.stream().anyMatch(frame -> frame.contains("event:call1_start")));
        assertTrue(wireFrames.stream().anyMatch(frame -> frame.contains("event:call2_token")));
        assertTrue(wireFrames.stream().anyMatch(frame -> frame.contains("event:done")));
        assertEquals(3, wireFrames.size());
    }

    private static AiReviewExecutionService executionService(final AiReviewAnalysisService analysis) {
        return new AiReviewExecutionService(analysis, new AiCancellationRegistry(), new SimpleMeterRegistry());
    }

    private static PreparedAiReview preparedReview(final String correlationId) {
        final Battle battle = new Battle();
        battle.arenaBonusType = 2;
        battle.players = List.of();
        final ReplayReconstruction reconstruction = mock(ReplayReconstruction.class);
        when(reconstruction.participants()).thenReturn(List.of());
        when(reconstruction.events()).thenReturn(List.of());
        final AiReviewRequest request = new AiReviewRequest(AllowedLanguage.ZH, correlationId, battle,
                reconstruction, List.of());
        return new PreparedAiReview(request, ReplayAnalysisScope.TEAM_PERSPECTIVE,
                AiReviewDonePayload.Capability.AVAILABLE, new AiCancellationToken());
    }

    private static final class RecordingEmitter extends SseEmitter {
        private final List<SseEventBuilder> events = new ArrayList<>();

        @Override
        public void send(final SseEventBuilder builder) {
            events.add(builder);
        }

        List<SseEventBuilder> events() {
            return List.copyOf(events);
        }
    }
}
