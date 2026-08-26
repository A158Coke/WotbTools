package com.wotb.web.exceptionhandler;

import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.replayfile.HallOfFameStorageException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.job.ExportQueueFullException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.apache.catalina.connector.ClientAbortException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.util.StringUtils;
import org.apache.tomcat.util.http.fileupload.impl.FileSizeLimitExceededException;
import org.apache.tomcat.util.http.fileupload.impl.SizeLimitExceededException;

import java.io.IOException;
import java.time.Instant;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final Pattern ERROR_CODE_PATTERN = Pattern.compile("[A-Z][A-Z0-9_]*");
    /** WoTB 账号业务拒绝：记录安全错误码用于诊断（不含 token / JWT / 敏感值）。 */
    private static final Set<String> WOTB_AUDIT_ERRORS = Set.of(
            "WOTB_CLAIMS_INVALID",
            "PROFILE_REGION_MISMATCH",
            "WOTB_ACCOUNT_MISMATCH",
            "WOTB_ACCOUNT_ALREADY_USED",
            "ASIA_PROFILE_READONLY",
            "WARGAMING_PROFILE_READONLY");

    private static Map<String, Object> body(final String error) {
        final Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", error);
        m.put("timestamp", Instant.now().toString());
        return m;
    }

    @ExceptionHandler(IOException.class)
    public ResponseEntity<Map<String, Object>> handleIOException(final IOException e) {
        if (isClientDisconnect(e)) {
            // client/proxy disconnected (Broken pipe, Connection reset): response may be committed,
            // do not attempt to write error JSON; downgrade to WARN without stack trace.
            log.warn("Client disconnected while writing response: {}", e.getMessage());
            return null;
        }
        log.warn("IO error: {}", e.getMessage());
        return ResponseEntity.badRequest().body(body("IO_ERROR"));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(final IllegalArgumentException e) {
        final String error = errorCode(e.getMessage(), "INVALID_ARGUMENT");
        final HttpStatus status = switch (error) {
            case "PROFILE_ALREADY_EXISTS", "WOTB_ACCOUNT_ALREADY_USED", "ALREADY_BOOSTER",
                 "BOOSTER_APPLICATION_ALREADY_OPEN", "AVERAGE_GOD_ALREADY_EXISTS", "PROFILE_REGION_MISMATCH",
                 "WOTB_ACCOUNT_MISMATCH" -> HttpStatus.CONFLICT;
            case "PROFILE_NOT_FOUND", "USER_PROFILE_NOT_FOUND", "BOOSTER_NOT_FOUND",
                 "REQUEST_NOT_FOUND", "BOOSTER_APPLICATION_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            default -> HttpStatus.BAD_REQUEST;
        };
        if (WOTB_AUDIT_ERRORS.contains(error)) {
            // 安全诊断：仅业务错误码，不记录请求体 / Bearer Token / JWT。
            log.warn("WoTB account operation rejected: {}", error);
        }
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

    @ExceptionHandler(ExportQueueFullException.class)
    public ResponseEntity<Map<String, Object>> handleExportQueueFull(final ExportQueueFullException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(body("EXPORT_QUEUE_FULL"));
    }

    @ExceptionHandler(HallOfFameStorageException.class)
    public ResponseEntity<Map<String, Object>> handleHofStorage(final HallOfFameStorageException e) {
        return ResponseEntity.status(e.getStatus()).body(body(e.getCode()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxUploadSize(final MaxUploadSizeExceededException e) {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                .body(body(uploadTooLargeCode(e)));
    }

    /**
     * Multipart transport 错误码（BLOCKER 5）：框架解析失败发生在 controller 之前，
     * 正常用户的精确错误由 frontend preflight 提供。这里只按结构化 cause chain 区分：
     * Tomcat 单 part 超限 → {@code FILE_TOO_LARGE}；request 总大小超限 →
     * {@code TOTAL_REQUEST_TOO_LARGE}；无法结构区分（其他容器/未知 cause）→
     * 通用 {@code UPLOAD_TOO_LARGE}，绝不 parse exception message 猜测。HTTP 恒 413。
     */
    private static String uploadTooLargeCode(final MaxUploadSizeExceededException e) {
        Throwable cause = e;
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

    // framework client/request contract errors 是 4xx，不是服务器内部故障（不得落入 generic 500）。
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMediaTypeNotSupported(final HttpMediaTypeNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(body("UNSUPPORTED_MEDIA_TYPE"));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMethodNotSupported(final HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(body("METHOD_NOT_ALLOWED"));
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
        if (isClientDisconnect(e)) {
            log.warn("Client disconnected while writing response: {}", e.getMessage());
            return null;
        }
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body("INTERNAL_ERROR"));
    }

    // ── 辅助 ────────────────────────────────────────────────────────

    /**
     * Traverse the cause chain to detect a client/proxy disconnect while writing the response.
     *
     * <p>Matches: ClientAbortException (Tomcat), HttpMessageNotWritableException,
     * AsyncRequestNotUsableException; also any IOException whose message contains
     * "broken pipe" / "connection reset" / "forcibly closed".</p>
     *
     * <p>Package-private static so unit tests can verify cause-chain detection directly.</p>
     */
    static boolean isClientDisconnect(final Throwable t) {
        Throwable current = t;
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
