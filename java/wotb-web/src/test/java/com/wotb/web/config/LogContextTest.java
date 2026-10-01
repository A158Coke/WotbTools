package com.wotb.web.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wotb.core.observability.ApplicationLogger;
import com.wotb.core.observability.LogContext;
import com.wotb.web.replay.job.ReplayExportWorkerExecutor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.slf4j.event.Level;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LogContextTest {
    @AfterEach
    void clear() { MDC.clear(); }

    @Test
    void payloadBearingCauseMessagesAreRemovedWhileDiagnosticsSurvive() {
        final RuntimeException failure = new RuntimeException("raw replay payload",
                new IllegalArgumentException("private meta.json value"));
        failure.addSuppressed(new java.io.IOException("secret response body"));
        final Throwable safe = ApplicationLogger.diagnosticCause(failure);
        final java.io.StringWriter output = new java.io.StringWriter();
        safe.printStackTrace(new java.io.PrintWriter(output));
        org.junit.jupiter.api.Assertions.assertFalse(output.toString().contains("raw replay payload"));
        org.junit.jupiter.api.Assertions.assertFalse(output.toString().contains("private meta.json"));
        org.junit.jupiter.api.Assertions.assertFalse(output.toString().contains("secret response"));
        assertEquals(failure.getStackTrace().length, safe.getStackTrace().length);
        assertEquals(IllegalArgumentException.class.getName(), safe.getCause().getMessage());
        assertEquals(java.io.IOException.class.getName(), safe.getSuppressed()[0].getMessage());
    }

    @Test
    void snapshotAndNestedScopesRestoreEvenOnFailure() {
        MDC.put("userId", "validated-sub");
        final LogContext submitted = LogContext.capture();
        MDC.put("userId", "worker-previous");
        final Runnable task = submitted.wrap(() -> {
            assertEquals("validated-sub", MDC.get("userId"));
            try (final LogContext.Scope ignored = LogContext.with("jobId", "job-1")) {
                assertEquals("job-1", MDC.get("jobId"));
                throw new IllegalStateException("worker failure");
            }
        });
        assertThrows(IllegalStateException.class, task::run);
        assertEquals("worker-previous", MDC.get("userId"));
        assertNull(MDC.get("jobId"));
    }

    @Test
    void reusedExportThreadCannotLeakAuthenticatedIdentity() throws Exception {
        try (final ReplayExportWorkerExecutor executor = new ReplayExportWorkerExecutor(1, 2)) {
            MDC.put("userId", "jwt-sub");
            MDC.put("requestId", "request-1");
            final CompletableFuture<String> first = new CompletableFuture<>();
            executor.submit("job-1", () -> first.complete(MDC.get("userId") + ":" + MDC.get("requestId") + ":" + MDC.get("jobId")));
            assertEquals("jwt-sub:request-1:job-1", first.get(5, TimeUnit.SECONDS));
            MDC.clear();
            final CompletableFuture<String> second = new CompletableFuture<>();
            executor.submit("job-2", () -> second.complete(MDC.get("userId")));
            assertNull(second.get(5, TimeUnit.SECONDS));
        }
    }

    @Test
    void applicationEventKeepsStructuredFieldsAndOriginalCause() {
        final Logger logger = (Logger) LoggerFactory.getLogger("application-event-test");
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            final IllegalStateException failure = new IllegalStateException("unexpected", new java.io.IOException("root cause"));
            ApplicationLogger.event(logger, Level.ERROR, "replay_failed")
                    .addKeyValue("jobId", "job-42").setCause(failure).log("Replay failed");
            final ILoggingEvent event = appender.list.getFirst();
            assertEquals("event", event.getKeyValuePairs().getFirst().key);
            assertEquals("replay_failed", event.getKeyValuePairs().getFirst().value);
            assertEquals("java.io.IOException", event.getThrowableProxy().getCause().getClassName());
            assertEquals("root cause", event.getThrowableProxy().getCause().getMessage());
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}
