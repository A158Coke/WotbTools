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
    void fallbackKeepsCauseStacksAndFieldsWithoutProviderPayload() {
        final Logger logger = (Logger) LoggerFactory.getLogger(AiReviewEventLogTest.class);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            final IllegalStateException cause = new IllegalStateException("secret-completion");
            final RuntimeException failure = new RuntimeException("Bearer secret-token", cause);
            AiReviewEventLog.fallback(logger, "ai_test_fallback", failure, "without_prior");
            final ILoggingEvent event = appender.list.getFirst();
            assertTrue(event.getKeyValuePairs().stream().anyMatch(pair ->
                    pair.key.equals("fallbackPath") && pair.value.equals("without_prior")));
            assertEquals(failure.getStackTrace().length, event.getThrowableProxy().getStackTraceElementProxyArray().length);
            assertEquals(IllegalStateException.class.getName(), event.getThrowableProxy().getCause().getMessage());
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
