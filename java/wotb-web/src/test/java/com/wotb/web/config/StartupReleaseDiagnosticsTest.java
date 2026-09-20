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
    void logsBuildCommitImmutableImageTagAndCurrentFlywayMigrationCeiling() {
        final StartupReleaseDiagnostics diagnostics = new StartupReleaseDiagnostics(
                "0123456789abcdef0123456789abcdef01234567");

        diagnostics.logReleaseIdentity();

        assertTrue(appender.list.stream()
                        .map(ILoggingEvent::getFormattedMessage)
                        .anyMatch(message -> message.equals(
                                "WotBTools backend build=0123456789abcdef0123456789abcdef01234567 "
                                        + "imageTag=sha-0123456789ab Flyway migration ceiling=23")),
                "启动诊断必须打印 build commit、immutable image tag 与当前 migration ceiling");
    }

    @Test
    void marksNonReleaseBuildCommitImageTagAsUnavailable() {
        final StartupReleaseDiagnostics diagnostics = new StartupReleaseDiagnostics("local-dev");

        diagnostics.logReleaseIdentity();

        assertTrue(appender.list.stream()
                        .map(ILoggingEvent::getFormattedMessage)
                        .anyMatch(message -> message.contains("build=local-dev imageTag=unavailable")),
                "非完整 release SHA 不得伪装成 immutable image tag");
    }
}
