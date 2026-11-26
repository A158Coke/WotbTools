package com.wotb.web.config;

import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.OutputStreamAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.logging.logback.StructuredLogEncoder;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LogstashMdcTopLevelTest {

    @Test
    void mdcRequestIdIsTopLevelJsonField() throws Exception {
        final LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        context.putObject(Environment.class.getName(), new StandardEnvironment());

        final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        final OutputStreamAppender<ILoggingEvent> appender = new OutputStreamAppender<>();
        appender.setContext(context);
        appender.setOutputStream(buffer);

        final StructuredLogEncoder encoder = new StructuredLogEncoder();
        encoder.setContext(context);
        encoder.setFormat("logstash");
        encoder.start();
        appender.setEncoder(encoder);
        appender.start();

        final ch.qos.logback.classic.Logger logger = context.getLogger("probe");
        try {
            logger.addAppender(appender);
            MDC.put("requestId", "abc-123");
            logger.info("hello");
        } finally {
            MDC.remove("requestId");
            logger.detachAppender(appender);
        }

        final String json = buffer.toString(StandardCharsets.UTF_8);
        assertTrue(json.contains("\"requestId\":\"abc-123\""),
                "requestId must be a top-level field, actual: " + json);
        assertFalse(json.matches(".*\"mdc\"\\s*:\\s*\\{.*requestId.*"),
                "requestId must not be nested under mdc, actual: " + json);
        assertFalse(json.contains("\"_requestId\""),
                "requestId must not get an underscore prefix, actual: " + json);
    }
}
