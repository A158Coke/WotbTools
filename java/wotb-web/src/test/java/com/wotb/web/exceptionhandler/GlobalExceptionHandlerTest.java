package com.wotb.web.exceptionhandler;

import com.wotb.web.util.apierror.ApiErrorResponse;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.apierror.RequestTrace;
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
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.io.IOException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
                        && e.getFormattedMessage().contains("api_request_failed"))
                .toList();
    }


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


    @Test
    void genericExceptionStillErrors() {
        final ResponseEntity<ApiErrorResponse> response =
                handler.handleGeneral(new IllegalStateException("boom"));

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertEquals("INTERNAL_ERROR", response.getBody().errorCode());
        assertEquals(500, response.getBody().status());
        assertFalse(response.getBody().id().isBlank());
        assertTrue(response.getBody().retryable());
        assertTrue(response.getBody().details().isEmpty());
        assertNotNull(response.getBody().timestamp());
        assertEquals(1, errorEvents().size(), "ordinary exceptions must log Unhandled exception ERROR");
    }

    @Test
    void typedInternalErrorResponseIdIsLoggedAndSearchable() {
        final MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/replay/probe");
        request.setAttribute(RequestTrace.REQUEST_ATTRIBUTE, "trace-log-500");
        final ApiException exception = new ApiException(ApiErrorCode.INTERNAL_ERROR, "safe diagnostic", java.util.Map.of());

        final ResponseEntity<ApiErrorResponse> response = handler.handleApiException(exception, request);

        assertEquals(exception.id(), response.getBody().id());
        assertTrue(errorEvents().stream().anyMatch(event ->
                event.getFormattedMessage().contains("traceId=trace-log-500")
                        && event.getFormattedMessage().contains("id=" + exception.id())
                        && event.getFormattedMessage().contains("errorMsg=safe diagnostic")));
    }

    @Test
    void clientAbortDoesNotEnterGenericErrorPath() {
        final ResponseEntity<ApiErrorResponse> response =
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
        final ResponseEntity<ApiErrorResponse> response =
                handler.handleGeneral(new IllegalStateException("outer",
                        new HttpMessageNotWritableException("write failed",
                                new ClientAbortException("Connection reset by peer"))));

        assertNull(response);
        assertEquals(0, errorEvents().size());
    }

    @Test
    void clientAbortInHandleIoReturnsNull() {
        final ResponseEntity<ApiErrorResponse> response =
                handler.handleIOException(new ClientAbortException("Broken pipe"));

        assertNull(response, "disconnect in IOException handler must not write error JSON");
        assertEquals(0, errorEvents().size());
    }

    @Test
    void nonResetIoExceptionStillReturnsIoError() {
        final ResponseEntity<ApiErrorResponse> response =
                handler.handleIOException(new IOException("disk full"));

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertEquals("IO_ERROR", response.getBody().errorCode());
        assertEquals(0, errorEvents().size(), "IO_ERROR is a handled warning, not Unhandled exception");
    }


    @Test
    void singlePartTooLargeMapsToFileTooLargeWith413() {
        final MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(-1,
                new FileSizeLimitExceededException("The field files exceeds its maximum permitted size",
                        27_000_000L, 20L * 1024 * 1024));
        final ResponseEntity<ApiErrorResponse> response = handler.handleMaxUploadSize(ex);

        assertEquals(HttpStatus.CONTENT_TOO_LARGE, response.getStatusCode());
        assertEquals("FILE_TOO_LARGE", response.getBody().errorCode());
    }

    @Test
    void requestTooLargeMapsToTotalRequestTooLargeWith413() {
        final MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(-1,
                new SizeLimitExceededException("The request was rejected because its size exceeds the configured maximum",
                        210L * 1024 * 1024, 200L * 1024 * 1024));
        final ResponseEntity<ApiErrorResponse> response = handler.handleMaxUploadSize(ex);

        assertEquals(HttpStatus.CONTENT_TOO_LARGE, response.getStatusCode());
        assertEquals("TOTAL_REQUEST_TOO_LARGE", response.getBody().errorCode());
    }

    @Test
    void realTomcatCauseChainMapsToFileTooLarge() {
        final MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(-1,
                new InvalidParameterException(new FileSizeLimitExceededException(
                        "The field files exceeds its maximum permitted size of 20971520 bytes.",
                        27_000_000L, 20L * 1024 * 1024), 413));
        final ResponseEntity<ApiErrorResponse> response = handler.handleMaxUploadSize(ex);

        assertEquals(HttpStatus.CONTENT_TOO_LARGE, response.getStatusCode());
        assertEquals("FILE_TOO_LARGE", response.getBody().errorCode());
    }

    @Test
    void maxUploadWithoutStructuredCauseFallsBackToGenericUploadTooLarge() {
        final MaxUploadSizeExceededException plain = new MaxUploadSizeExceededException(-1);
        final ResponseEntity<ApiErrorResponse> plainResponse = handler.handleMaxUploadSize(plain);
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, plainResponse.getStatusCode());
        assertEquals("UPLOAD_TOO_LARGE", plainResponse.getBody().errorCode());

        final MaxUploadSizeExceededException msgCause = new MaxUploadSizeExceededException(-1,
                new IOException("Maximum upload size of 20971520 bytes exceeded"));
        final ResponseEntity<ApiErrorResponse> msgResponse = handler.handleMaxUploadSize(msgCause);
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, msgResponse.getStatusCode());
        assertEquals("UPLOAD_TOO_LARGE", msgResponse.getBody().errorCode());
    }
}
