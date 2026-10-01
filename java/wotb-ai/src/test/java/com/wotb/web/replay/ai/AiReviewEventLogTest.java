package com.wotb.web.replay.ai;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

class AiReviewEventLogTest {
    @Test
    void validationInfoUsesStructuredMetadataAndProviderRootDiagnosticSurvives() {
        final Logger logger = (Logger) LoggerFactory.getLogger(AiReviewEventLogTest.class);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            AiReviewEventLog.info(logger, "team_review_validation", "corr-safe",
                    "errorCode", "AI_REVIEW_SCHEMA_FAILED", "attempt", 2);
            final ILoggingEvent validation = appender.list.getFirst();
            assertEquals(ch.qos.logback.classic.Level.INFO, validation.getLevel());
            assertTrue(validation.getKeyValuePairs().stream().anyMatch(pair ->
                    pair.key.equals("event") && pair.value.equals("team_review_validation")));
            assertTrue(validation.getKeyValuePairs().stream().anyMatch(pair ->
                    pair.key.equals("correlationId") && pair.value.equals("corr-safe")));
            assertFalse(validation.getFormattedMessage().contains("prompt="));
            assertFalse(validation.getFormattedMessage().contains("completion="));
            final var failure = new com.wotb.web.replay.ai.gateway.AiUpstreamException("AI_TIMEOUT", 504, "corr-safe",
                    new IllegalStateException("private provider completion"));
            AiReviewEventLog.upstreamFailure(logger, "ai_upstream_failed", "corr-safe", failure);
            final var throwable = appender.list.getLast().getThrowableProxy();
            assertEquals(com.wotb.web.replay.ai.gateway.AiUpstreamException.class.getName(), throwable.getClassName());
            assertEquals("AI_TIMEOUT", throwable.getMessage());
            assertFalse(throwable.getCause().getMessage().contains("private provider"));
            AiReviewEventLog.fallback(logger, "ai_feature_extraction_failed",
                    new IllegalStateException("feature tensor shape mismatch"), "without_extracted_features");
            assertEquals(IllegalStateException.class.getName(), appender.list.getLast().getThrowableProxy().getClassName());
            assertEquals("feature tensor shape mismatch", appender.list.getLast().getThrowableProxy().getMessage());
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void fallbackKeepsCauseStacksAndFieldsWithoutProviderPayload() {
        final Logger logger = (Logger) LoggerFactory.getLogger(AiReviewEventLogTest.class);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            final IllegalStateException cause = new IllegalStateException("secret-completion");
            final RuntimeException failure = new RuntimeException("Bearer secret-token", cause);
            AiReviewEventLog.providerFallback(logger, "ai_test_fallback", failure, "without_prior");
            final ILoggingEvent event = appender.list.getFirst();
            assertTrue(event.getKeyValuePairs().stream().anyMatch(pair ->
                    pair.key.equals("fallbackPath") && pair.value.equals("without_prior")));
            assertEquals(failure.getStackTrace().length, event.getThrowableProxy().getStackTraceElementProxyArray().length);
            assertTrue(event.getThrowableProxy().getCause().getMessage().contains(IllegalStateException.class.getName()));
            assertFalse(event.getThrowableProxy().getMessage().contains("secret-token"));
            assertFalse(event.getThrowableProxy().getCause().getMessage().contains("secret-completion"));
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void platformWorkerCapturesIdentityAndDoesNotLeakToNextTask() throws Exception {
        try (final AiReviewWorkerExecutor executor = new AiReviewWorkerExecutor(1, 1, 60, false, null)) {
            final CompletableFuture<String> first = new CompletableFuture<>();
            MDC.put("userId", "jwt-sub");
            executor.execute(() -> first.complete(MDC.get("userId")));
            MDC.clear();
            assertEquals("jwt-sub", first.get(5, TimeUnit.SECONDS));
            final CompletableFuture<String> second = new CompletableFuture<>();
            executor.execute(() -> second.complete(MDC.get("userId")));
            assertNull(second.get(5, TimeUnit.SECONDS));
        } finally {
            MDC.clear();
        }
    }
}
