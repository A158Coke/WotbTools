package com.wotb.web.exceptionhandler;

import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.MixedAnalysisScopesException;
import com.wotb.core.replay.processing.MixedRandomBattleRecordersException;
import com.wotb.core.replay.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.replay.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.AiReviewBusyException;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import com.wotb.web.replay.job.ExportQueueFullException;
import com.wotb.web.replay.job.ProcessingQueueFullException;
import com.wotb.web.replayfile.HallOfFameStorageException;
import com.wotb.web.util.apierror.ApiErrorFactory;
import com.wotb.web.util.apierror.ApiErrorResponse;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.apierror.RequestTrace;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.catalina.connector.ClientAbortException;
import org.apache.tomcat.util.http.fileupload.impl.FileSizeLimitExceededException;
import org.apache.tomcat.util.http.fileupload.impl.SizeLimitExceededException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.util.StringUtils;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Maps Spring MVC and legacy domain exceptions to the canonical API error contract. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final Pattern ERROR_CODE_PATTERN = Pattern.compile("[A-Z][A-Z0-9_]*");
    private static final Set<String> WOTB_AUDIT_ERRORS = Set.of(
            "WOTB_CLAIMS_INVALID",
            "PROFILE_REGION_MISMATCH",
            "WOTB_ACCOUNT_MISMATCH",
            "WOTB_ACCOUNT_ALREADY_USED",
            "ASIA_PROFILE_READONLY",
            "WARGAMING_PROFILE_READONLY");

    private final ApiErrorFactory factory;

    public GlobalExceptionHandler() {
        this(new ApiErrorFactory());
    }

    @Autowired
    public GlobalExceptionHandler(final ApiErrorFactory factory) {
        this.factory = factory;
    }

    public ResponseEntity<ApiErrorResponse> handleIllegalArgument(final IllegalArgumentException exception) {
        return handleIllegalArgument(exception, null);
    }

    public ResponseEntity<ApiErrorResponse> handleReplayBusy(final ReplayBusyException exception) {
        return handleReplayBusy(exception, null);
    }

    public ResponseEntity<ApiErrorResponse> handleIOException(final IOException exception) {
        return handleIOException(exception, null);
    }

    public ResponseEntity<ApiErrorResponse> handleMaxUploadSize(final MaxUploadSizeExceededException exception) {
        return handleMaxUploadSize(exception, null);
    }

    public ResponseEntity<ApiErrorResponse> handleGeneral(final Exception exception) {
        return handleGeneral(exception, null);
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(
            final ApiException exception, final HttpServletRequest request) {
        return response(factory.create(exception, request), exception, request);
    }

    @ExceptionHandler(IOException.class)
    public ResponseEntity<ApiErrorResponse> handleIOException(
            final IOException exception, final HttpServletRequest request) {
        if (isClientDisconnect(exception)) {
            log.warn("Client disconnected while writing response: {}", exception.getMessage());
            return null;
        }
        return response("IO_ERROR", HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiErrorResponse> handleIllegalArgument(
            final IllegalArgumentException exception, final HttpServletRequest request) {
        final String code = errorCode(exception.getMessage(), "INVALID_ARGUMENT");
        final HttpStatus status = switch (code) {
            case "PROFILE_ALREADY_EXISTS", "WOTB_ACCOUNT_ALREADY_USED", "ALREADY_BOOSTER",
                 "BOOSTER_APPLICATION_ALREADY_OPEN", "AVERAGE_GOD_ALREADY_EXISTS", "PROFILE_REGION_MISMATCH",
                 "WOTB_ACCOUNT_MISMATCH" -> HttpStatus.CONFLICT;
            case "PROFILE_NOT_FOUND", "USER_PROFILE_NOT_FOUND", "BOOSTER_NOT_FOUND",
                 "REQUEST_NOT_FOUND", "BOOSTER_APPLICATION_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            default -> HttpStatus.BAD_REQUEST;
        };
        if (WOTB_AUDIT_ERRORS.contains(code)) {
            log.warn("WoTB account operation rejected: {}", code);
        }
        return response(code, status, exception, request);
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiErrorResponse> handleIllegalState(
            final IllegalStateException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getMessage(), "INVALID_STATE"),
                HttpStatus.CONFLICT, exception, request);
    }

    @ExceptionHandler(ReplayBusyException.class)
    public ResponseEntity<ApiErrorResponse> handleReplayBusy(
            final ReplayBusyException exception, final HttpServletRequest request) {
        return response("REPLAY_BUSY", HttpStatus.SERVICE_UNAVAILABLE, exception, request);
    }

    @ExceptionHandler(ProcessingQueueFullException.class)
    public ResponseEntity<ApiErrorResponse> handleProcessingQueueFull(
            final ProcessingQueueFullException exception, final HttpServletRequest request) {
        return response("PROCESSING_QUEUE_FULL", HttpStatus.SERVICE_UNAVAILABLE, exception, request);
    }

    @ExceptionHandler(ExportQueueFullException.class)
    public ResponseEntity<ApiErrorResponse> handleExportQueueFull(
            final ExportQueueFullException exception, final HttpServletRequest request) {
        return response("EXPORT_QUEUE_FULL", HttpStatus.SERVICE_UNAVAILABLE, exception, request);
    }

    @ExceptionHandler(AiReviewBusyException.class)
    public ResponseEntity<ApiErrorResponse> handleAiReviewBusy(
            final AiReviewBusyException exception, final HttpServletRequest request) {
        return response("AI_REVIEW_BUSY", HttpStatus.SERVICE_UNAVAILABLE, exception, request);
    }

    @ExceptionHandler(AiNotConfiguredException.class)
    public ResponseEntity<ApiErrorResponse> handleAiNotConfigured(
            final AiNotConfiguredException exception, final HttpServletRequest request) {
        return response("AI_NOT_CONFIGURED", HttpStatus.SERVICE_UNAVAILABLE, exception, request);
    }

    @ExceptionHandler(AiUpstreamException.class)
    public ResponseEntity<ApiErrorResponse> handleAiUpstream(
            final AiUpstreamException exception, final HttpServletRequest request) {
        return response(errorCode(exception.code(), "AI_UPSTREAM_ERROR"),
                HttpStatus.BAD_GATEWAY, exception, request);
    }

    @ExceptionHandler(AiPromptBudgetExceededException.class)
    public ResponseEntity<ApiErrorResponse> handleAiPromptBudget(
            final AiPromptBudgetExceededException exception, final HttpServletRequest request) {
        return response("AI_PROMPT_MANDATORY_SECTION_TOO_LARGE",
                HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(ReplayFileCountExceededException.class)
    public ResponseEntity<ApiErrorResponse> handleReplayFileCount(
            final ReplayFileCountExceededException exception, final HttpServletRequest request) {
        final Map<String, Object> details = Map.of(
                "maxFiles", exception.getMaxFiles(),
                "actualFiles", exception.getActualFiles());
        final ApiErrorResponse error = factory.create(
                "REPLAY_FILE_COUNT_EXCEEDED", HttpStatus.BAD_REQUEST, details, request);
        return response(error, exception, request);
    }

    @ExceptionHandler(UnsupportedReplayAnalysisModeException.class)
    public ResponseEntity<ApiErrorResponse> handleUnsupportedMode(
            final UnsupportedReplayAnalysisModeException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getMessage(), "UNSUPPORTED_ANALYSIS_MODE"),
                HttpStatus.UNPROCESSABLE_ENTITY, exception, request);
    }

    @ExceptionHandler(PerspectiveTeamNotResolvedException.class)
    public ResponseEntity<ApiErrorResponse> handlePerspectiveTeam(
            final PerspectiveTeamNotResolvedException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getMessage(), "PERSPECTIVE_TEAM_NOT_RESOLVED"),
                HttpStatus.UNPROCESSABLE_ENTITY, exception, request);
    }

    @ExceptionHandler(MixedAnalysisScopesException.class)
    public ResponseEntity<ApiErrorResponse> handleMixedScopes(
            final MixedAnalysisScopesException exception, final HttpServletRequest request) {
        return response("MIXED_ANALYSIS_SCOPES", HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(MixedRandomBattleRecordersException.class)
    public ResponseEntity<ApiErrorResponse> handleMixedRecorders(
            final MixedRandomBattleRecordersException exception, final HttpServletRequest request) {
        return response("MIXED_RANDOM_BATTLE_RECORDERS", HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(HallOfFameStorageException.class)
    public ResponseEntity<ApiErrorResponse> handleHofStorage(
            final HallOfFameStorageException exception, final HttpServletRequest request) {
        return response(exception.getCode(), exception.getStatus(), exception, request);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiErrorResponse> handleMaxUploadSize(
            final MaxUploadSizeExceededException exception, final HttpServletRequest request) {
        return response(uploadTooLargeCode(exception), HttpStatus.CONTENT_TOO_LARGE, exception, request);
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<ApiErrorResponse> handleMultipart(
            final MultipartException exception, final HttpServletRequest request) {
        return response("MULTIPART_ERROR", HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiErrorResponse> handleMissingParam(
            final MissingServletRequestParameterException exception, final HttpServletRequest request) {
        return response("MISSING_PARAM", HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentNotValidException.class,
            HandlerMethodValidationException.class})
    public ResponseEntity<ApiErrorResponse> handleInvalidRequest(
            final Exception exception, final HttpServletRequest request) {
        return response("INVALID_REQUEST", HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleArgumentTypeMismatch(
            final MethodArgumentTypeMismatchException exception, final HttpServletRequest request) {
        return response("INVALID_ARGUMENT", HttpStatus.BAD_REQUEST,
                exception, request);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMediaTypeNotSupported(
            final HttpMediaTypeNotSupportedException exception, final HttpServletRequest request) {
        return response("UNSUPPORTED_MEDIA_TYPE", HttpStatus.UNSUPPORTED_MEDIA_TYPE, exception, request);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMethodNotSupported(
            final HttpRequestMethodNotSupportedException exception, final HttpServletRequest request) {
        return response("METHOD_NOT_ALLOWED", HttpStatus.METHOD_NOT_ALLOWED, exception, request);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiErrorResponse> handleResponseStatus(
            final ResponseStatusException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getReason(), "RESPONSE_STATUS"),
                HttpStatus.valueOf(exception.getStatusCode().value()), exception, request);
    }

    @ExceptionHandler(AdminBadRequestException.class)
    public ResponseEntity<ApiErrorResponse> handleAdminBadRequest(
            final AdminBadRequestException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getErrorCode(), "ADMIN_BAD_REQUEST"),
                HttpStatus.BAD_REQUEST, exception, request);
    }

    @ExceptionHandler(AdminConflictException.class)
    public ResponseEntity<ApiErrorResponse> handleAdminConflict(
            final AdminConflictException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getErrorCode(), "ADMIN_CONFLICT"),
                HttpStatus.CONFLICT, exception, request);
    }

    @ExceptionHandler(AdminInternalException.class)
    public ResponseEntity<ApiErrorResponse> handleAdminInternal(
            final AdminInternalException exception, final HttpServletRequest request) {
        return response(errorCode(exception.getErrorCode(), "ADMIN_INTERNAL_ERROR"),
                HttpStatus.INTERNAL_SERVER_ERROR, exception, request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleGeneral(
            final Exception exception, final HttpServletRequest request) {
        if (isClientDisconnect(exception)) {
            log.warn("Client disconnected while writing response: {}", exception.getMessage());
            return null;
        }
        return response("INTERNAL_ERROR", HttpStatus.INTERNAL_SERVER_ERROR, exception, request);
    }

    private ResponseEntity<ApiErrorResponse> response(
            final String code, final HttpStatus status, final Throwable exception,
            final HttpServletRequest request) {
        return response(factory.create(code, status, request), exception, request);
    }

    private ResponseEntity<ApiErrorResponse> response(
            final ApiErrorResponse error, final Throwable exception,
            final HttpServletRequest request) {
        final String method = request == null ? "UNKNOWN" : request.getMethod();
        final String path = request == null ? "UNKNOWN" : request.getRequestURI();
        final String traceId = RequestTrace.resolve(request);
        final String responseId = error.id();
        final String responseErrorMsg = error.errorMsg();
        if (error.status() >= 500) {
            log.error("api_request_failed traceId={} id={} errorCode={} status={} method={} path={} errorMsg={}",
                    traceId, responseId, error.errorCode(), error.status(), method, path,
                    responseErrorMsg, exception);
        } else {
            log.info("api_request_rejected traceId={} id={} errorCode={} status={} method={} path={} errorMsg={}",
                    traceId, responseId, error.errorCode(), error.status(), method, path, responseErrorMsg);
        }
        return ResponseEntity.status(error.status()).body(error);
    }

    private static String uploadTooLargeCode(final MaxUploadSizeExceededException exception) {
        Throwable cause = exception;
        while (cause != null) {
            if (cause instanceof FileSizeLimitExceededException) {
                return "FILE_TOO_LARGE";
            }
            if (cause instanceof SizeLimitExceededException) {
                return "TOTAL_REQUEST_TOO_LARGE";
            }
            cause = cause.getCause();
        }
        return "UPLOAD_TOO_LARGE";
    }

    static boolean isClientDisconnect(final Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof ClientAbortException
                    || current instanceof HttpMessageNotWritableException
                    || current instanceof AsyncRequestNotUsableException) {
                return true;
            }
            if (current instanceof IOException && isResetMessage(current.getMessage())) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private static boolean isResetMessage(final String message) {
        if (message == null) {
            return false;
        }
        final String lower = message.toLowerCase(Locale.ROOT);
        return lower.contains("broken pipe")
                || lower.contains("connection reset")
                || lower.contains("forcibly closed");
    }

    /** Accept only stable English error codes, never exception details. */
    static String errorCode(final String value, final String fallback) {
        if (!StringUtils.hasText(value)) {
            return fallback;
        }
        final int separator = value.indexOf(':');
        final String candidate = (separator >= 0 ? value.substring(0, separator) : value).trim();
        return ERROR_CODE_PATTERN.matcher(candidate).matches() ? candidate : fallback;
    }
}
