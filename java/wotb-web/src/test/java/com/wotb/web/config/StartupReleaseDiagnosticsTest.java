package com.wotb.web.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.junit.jupiter.api.Assertions.assertTrue;

class StartupReleaseDiagnosticsTest {

    private Logger logger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void setUp() {
        logger = (Logger) LoggerFactory.getLogger(StartupReleaseDiagnostics.class);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
    }

    @Test
    void logsBuildCommitAndCurrentFlywayMigrationCeiling() {
        final StartupReleaseDiagnostics diagnostics = new StartupReleaseDiagnostics("abc123");

        diagnostics.logReleaseIdentity();

        assertTrue(appender.list.stream()
                        .map(ILoggingEvent::getFormattedMessage)
                        .anyMatch(message -> message.equals(
                                "WotBTools backend build=abc123 Flyway migration ceiling=22")),
                "启动诊断必须打印 build commit 与当前 migration ceiling");
    }
}
