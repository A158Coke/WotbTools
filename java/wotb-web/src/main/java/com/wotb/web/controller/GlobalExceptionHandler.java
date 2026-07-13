package com.wotb.web.controller;

import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.replay.exception.ReplayBusyException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final Pattern ERROR_CODE_PATTERN = Pattern.compile("[A-Z][A-Z0-9_]*");

    private static Map<String, Object> body(final String error) {
        final Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", error);
        m.put("timestamp", Instant.now().toString());
        return m;
    }

    @ExceptionHandler(IOException.class)
    public ResponseEntity<Map<String, Object>> handleIOException(final IOException e) {
        log.warn("IO error: {}", e.getMessage());
        return ResponseEntity.badRequest().body(body("IO_ERROR"));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(final IllegalArgumentException e) {
        final String error = errorCode(e.getMessage(), "INVALID_ARGUMENT");
        final HttpStatus status = switch (error) {
            case "PROFILE_ALREADY_EXISTS", "WOTB_ACCOUNT_ALREADY_USED", "ALREADY_BOOSTER",
                 "BOOSTER_APPLICATION_ALREADY_OPEN" -> HttpStatus.CONFLICT;
            case "PROFILE_NOT_FOUND", "USER_PROFILE_NOT_FOUND", "BOOSTER_NOT_FOUND",
                 "REQUEST_NOT_FOUND", "BOOSTER_APPLICATION_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            default -> HttpStatus.BAD_REQUEST;
        };
        return ResponseEntity.status(status).body(body(error));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalState(final IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(body(errorCode(e.getMessage(), "INVALID_STATE")));
    }

    @ExceptionHandler(ReplayBusyException.class)
    public ResponseEntity<Map<String, Object>> handleReplayBusy(final ReplayBusyException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(body("REPLAY_BUSY"));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxUploadSize(final MaxUploadSizeExceededException e) {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                .body(body("FILE_TOO_LARGE"));
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<Map<String, Object>> handleMultipart(final MultipartException e) {
        return ResponseEntity.badRequest()
                .body(body("MULTIPART_ERROR"));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, Object>> handleMissingParam(final MissingServletRequestParameterException e) {
        return ResponseEntity.badRequest()
                .body(body("MISSING_PARAM"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(final ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode())
                .body(body(errorCode(e.getReason(), "RESPONSE_STATUS")));
    }

    // ── 管理员 API 异常 ────────────────────────────────────────────
    @ExceptionHandler(AdminBadRequestException.class)
    public ResponseEntity<Map<String, Object>> handleAdminBadRequest(final AdminBadRequestException e) {
        return ResponseEntity.badRequest()
                .body(body(errorCode(e.getErrorCode(), "ADMIN_BAD_REQUEST")));
    }

    @ExceptionHandler(AdminConflictException.class)
    public ResponseEntity<Map<String, Object>> handleAdminConflict(final AdminConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(body(errorCode(e.getErrorCode(), "ADMIN_CONFLICT")));
    }

    @ExceptionHandler(AdminInternalException.class)
    public ResponseEntity<Map<String, Object>> handleAdminInternal(final AdminInternalException e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body(errorCode(e.getErrorCode(), "ADMIN_INTERNAL_ERROR")));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneral(final Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body("INTERNAL_ERROR"));
    }

    // ── 辅助 ────────────────────────────────────────────────────────

    /** 仅允许稳定英文错误码出现在 API 中，避免回显异常细节或本地化文案。 */
    private static String errorCode(final String value, final String fallback) {
        if (!StringUtils.hasText(value)) {
            return fallback;
        }
        final int separator = value.indexOf(':');
        final String candidate = (separator >= 0 ? value.substring(0, separator) : value).trim();
        return ERROR_CODE_PATTERN.matcher(candidate).matches() ? candidate : fallback;
    }
}
