package com.wotb.ai.review;

import com.wotb.ai.http.ApiErrorResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.ExceptionHandler;
import com.wotb.ai.review.controller.AiReviewCancellationController;
import com.wotb.ai.review.controller.AiReviewSubmissionController;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Map;

@RestControllerAdvice(assignableTypes = {AiReviewSubmissionController.class, AiReviewCancellationController.class})
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AiReviewExceptionHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReviewExceptionHandler.class);

    private static final int SERVICE_UNAVAILABLE = 503;

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiErrorResponse> handleResponseStatus(final ResponseStatusException error) {
        final int status = error.getStatusCode().value();
        final String errorCode = error.getReason() == null ? "INVALID_REQUEST" : error.getReason();
        LOGGER.info("ai_review_rejected errorCode={} status={}", errorCode, status);
        return ResponseEntity.status(status).body(new ApiErrorResponse(
                null, errorCode, null, status, status == SERVICE_UNAVAILABLE, Map.of(), Instant.now()));
    }
}
