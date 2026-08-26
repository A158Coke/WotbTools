package com.wotb.web.exceptionhandler;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.apache.catalina.connector.ClientAbortException;
import org.apache.tomcat.util.http.InvalidParameterException;
import org.apache.tomcat.util.http.fileupload.impl.FileSizeLimitExceededException;
import org.apache.tomcat.util.http.fileupload.impl.SizeLimitExceededException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证客户端/反向代理断连（Broken pipe、Connection reset）不进入普通 Unhandled exception ERROR 路径：
 * <ul>
 *   <li>cause-chain 断连识别（含多层包装）</li>
 *   <li>断连时返回 null（不再写错误 JSON）且仅 WARN、无 ERROR 堆栈</li>
 *   <li>普通未处理异常仍按 ERROR + INTERNAL_ERROR 处理</li>
 *   <li>非断连 IOException 不被错误忽略</li>
 * </ul>
 */
class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler handler;
    private ch.qos.logback.classic.Logger logger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void setUp() {
        handler = new GlobalExceptionHandler();
        logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
                "com.wotb.web.exceptionhandler.GlobalExceptionHandler");
        final Level old = logger.getLevel();
        logger.setLevel(Level.ALL);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(old);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
    }

    private List<ILoggingEvent> errorEvents() {
        return appender.list.stream()
                .filter(e -> e.getLevel() == Level.ERROR)
                .filter(e -> e.getFormattedMessage() != null
                        && e.getFormattedMessage().contains("Unhandled exception"))
                .toList();
    }

    // ---- cause-chain 识别 ----

    @Test
    void clientAbortExceptionIsDetected() {
        assertTrue(GlobalExceptionHandler.isClientDisconnect(
                new ClientAbortException("Broken pipe")));
    }

    @Test
    void httpMessageNotWritableIsDetected() {
        assertTrue(GlobalExceptionHandler.isClientDisconnect(
                new HttpMessageNotWritableException("failed to write response",
                        new IOException("Broken pipe"))));
    }

    @Test
    void asyncRequestNotUsableIsDetected() {
        assertTrue(GlobalExceptionHandler.isClientDisconnect(
                new AsyncRequestNotUsableException("Connection reset by peer")));
    }

    @Test
    void deeplyWrappedClientAbortIsDetected() {
        final Exception wrapped = new IllegalStateException("outer",
                new HttpMessageNotWritableException("write failed",
                        new ClientAbortException("Connection reset by peer")));
        assertTrue(GlobalExceptionHandler.isClientDisconnect(wrapped));
    }

    @Test
    void ioExceptionWithBrokenPipeMessageIsDetected() {
        assertTrue(GlobalExceptionHandler.isClientDisconnect(
                new IOException("Broken pipe")));
        assertTrue(GlobalExceptionHandler.isClientDisconnect(
                new IOException("Connection reset by peer")));
    }

    @Test
    void plainIoExceptionIsNotDisconnect() {
        assertFalse(GlobalExceptionHandler.isClientDisconnect(
                new IOException("disk full")));
        assertFalse(GlobalExceptionHandler.isClientDisconnect(
                new IOException("simulated timeout")));
    }

    @Test
    void nullCauseChainIsNotDisconnect() {
        assertFalse(GlobalExceptionHandler.isClientDisconnect(null));
        assertFalse(GlobalExceptionHandler.isClientDisconnect(new IllegalStateException("plain")));
    }

    // ---- handler 行为 ----

    @Test
    void genericExceptionStillErrors() {
        final ResponseEntity<Map<String, Object>> response =
                handler.handleGeneral(new IllegalStateException("boom"));

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertEquals("INTERNAL_ERROR", response.getBody().get("error"));
        assertEquals(1, errorEvents().size(), "ordinary exceptions must log Unhandled exception ERROR");
    }

    @Test
    void clientAbortDoesNotEnterGenericErrorPath() {
        final ResponseEntity<Map<String, Object>> response =
                handler.handleGeneral(new ClientAbortException("Broken pipe"));

        assertNull(response, "disconnect must not attempt to write an error JSON response");
        assertEquals(0, errorEvents().size(), "disconnect must not log Unhandled exception ERROR");
        assertTrue(appender.list.stream().anyMatch(e ->
                        e.getLevel() == Level.WARN
                                && e.getFormattedMessage() != null
                                && e.getFormattedMessage().contains("Client disconnected")),
                "disconnect must be logged as WARN");
    }

    @Test
    void wrappedClientAbortInHandleGeneralReturnsNull() {
        final ResponseEntity<Map<String, Object>> response =
                handler.handleGeneral(new IllegalStateException("outer",
                        new HttpMessageNotWritableException("write failed",
                                new ClientAbortException("Connection reset by peer"))));

        assertNull(response);
        assertEquals(0, errorEvents().size());
    }

    @Test
    void clientAbortInHandleIoReturnsNull() {
        final ResponseEntity<Map<String, Object>> response =
                handler.handleIOException(new ClientAbortException("Broken pipe"));

        assertNull(response, "disconnect in IOException handler must not write error JSON");
        assertEquals(0, errorEvents().size());
    }

    @Test
    void nonResetIoExceptionStillReturnsIoError() {
        final ResponseEntity<Map<String, Object>> response =
                handler.handleIOException(new IOException("disk full"));

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertEquals("IO_ERROR", response.getBody().get("error"));
        assertEquals(0, errorEvents().size(), "IO_ERROR is a handled warning, not Unhandled exception");
    }

    // ---- BLOCKER 5：MaxUploadSizeExceededException transport contract（HTTP 恒 413）----

    @Test
    void singlePartTooLargeMapsToFileTooLargeWith413() {
        final MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(-1,
                new FileSizeLimitExceededException("The field files exceeds its maximum permitted size",
                        27_000_000L, 20L * 1024 * 1024));
        final ResponseEntity<Map<String, Object>> response = handler.handleMaxUploadSize(ex);

        assertEquals(HttpStatus.CONTENT_TOO_LARGE, response.getStatusCode());
        assertEquals("FILE_TOO_LARGE", response.getBody().get("error"));
    }

    @Test
    void requestTooLargeMapsToTotalRequestTooLargeWith413() {
        final MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(-1,
                new SizeLimitExceededException("The request was rejected because its size exceeds the configured maximum",
                        210L * 1024 * 1024, 200L * 1024 * 1024));
        final ResponseEntity<Map<String, Object>> response = handler.handleMaxUploadSize(ex);

        assertEquals(HttpStatus.CONTENT_TOO_LARGE, response.getStatusCode());
        assertEquals("TOTAL_REQUEST_TOO_LARGE", response.getBody().get("error"));
    }

    @Test
    void realTomcatCauseChainMapsToFileTooLarge() {
        // Tomcat 11: getParts → InvalidParameterException(SizeException, 413) → Spring 包装成
        // MaxUploadSizeExceededException。结构化 cause chain 必须能穿透识别。
        final MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(-1,
                new InvalidParameterException(new FileSizeLimitExceededException(
                        "The field files exceeds its maximum permitted size of 20971520 bytes.",
                        27_000_000L, 20L * 1024 * 1024), 413));
        final ResponseEntity<Map<String, Object>> response = handler.handleMaxUploadSize(ex);

        assertEquals(HttpStatus.CONTENT_TOO_LARGE, response.getStatusCode());
        assertEquals("FILE_TOO_LARGE", response.getBody().get("error"));
    }

    @Test
    void maxUploadWithoutStructuredCauseFallsBackToGenericUploadTooLarge() {
        // 无结构化 cause：不得 parse exception message 猜测 → 通用 UPLOAD_TOO_LARGE。
        final MaxUploadSizeExceededException plain = new MaxUploadSizeExceededException(-1);
        final ResponseEntity<Map<String, Object>> plainResponse = handler.handleMaxUploadSize(plain);
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, plainResponse.getStatusCode());
        assertEquals("UPLOAD_TOO_LARGE", plainResponse.getBody().get("error"));

        // message 含 "size exceeded" 但 cause 不是结构化 size 异常 → 仍不得按 message 猜测。
        final MaxUploadSizeExceededException msgCause = new MaxUploadSizeExceededException(-1,
                new IOException("Maximum upload size of 20971520 bytes exceeded"));
        final ResponseEntity<Map<String, Object>> msgResponse = handler.handleMaxUploadSize(msgCause);
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, msgResponse.getStatusCode());
        assertEquals("UPLOAD_TOO_LARGE", msgResponse.getBody().get("error"));
    }
}
