package com.wotb.ai.tournament;

import com.wotb.web.util.apierror.ApiErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Map;

/** Multipart failures can happen before a controller is selected, so this advice is guarded by exact path. */
@RestControllerAdvice
public class TournamentRecognitionExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(TournamentRecognitionExceptionHandler.class);

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handle(final Exception error, final HttpServletRequest request) throws Exception {
        if (!"/api/ai/tournament-groups/recognize".equals(request.getRequestURI())) throw error;
        final int status;
        final String errorCode;
        if (error instanceof ResponseStatusException rejection) {
            status = rejection.getStatusCode().value();
            errorCode = rejection.getReason() == null ? "INVALID_RECOGNITION_REQUEST" : rejection.getReason();
        } else if (error instanceof MaxUploadSizeExceededException) {
            status = 413;
            errorCode = "TOURNAMENT_IMAGE_TOO_LARGE";
        } else if (error instanceof HttpMediaTypeNotSupportedException) {
            status = 415;
            errorCode = "INVALID_RECOGNITION_REQUEST";
        } else if (error instanceof HttpRequestMethodNotSupportedException) {
            status = 405;
            errorCode = "METHOD_NOT_ALLOWED";
        } else if (error instanceof MultipartException || error instanceof MissingServletRequestPartException
                || error instanceof MissingServletRequestParameterException) {
            status = 400;
            errorCode = "INVALID_RECOGNITION_REQUEST";
        } else {
            status = 500;
            errorCode = "INTERNAL_ERROR";
            // Exception text/stack can contain provider request material; log only the exception type.
            LOGGER.error("tournament_recognition_failed errorType={}", error.getClass().getSimpleName());
        }
        return ResponseEntity.status(status).body(new ApiErrorResponse(null, errorCode, null, status,
                status == 503, Map.of(), Instant.now()));
    }
}
