package com.wotb.web.controller;

import com.wotb.web.util.ErrorCode;
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

import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private static Map<String, Object> body(final String error, final String message) {
        final Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", error);
        m.put("message", message);
        m.put("timestamp", Instant.now().toString());
        return m;
    }

    @ExceptionHandler(IOException.class)
    public ResponseEntity<Map<String, Object>> handleIOException(final IOException e) {
        log.warn("IO error: {}", e.getMessage());
        return ResponseEntity.badRequest().body(body("IO_ERROR", "文件读取失败: " + e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(final IllegalArgumentException e) {
        final String msg = e.getMessage();
        final HttpStatus status = switch (msg) {
            case "PROFILE_ALREADY_EXISTS", "WOTB_ACCOUNT_ALREADY_USED" -> HttpStatus.CONFLICT;
            case "PROFILE_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            default -> HttpStatus.BAD_REQUEST;
        };
        return ResponseEntity.status(status).body(body(msg, resolveMessage(msg)));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxUploadSize(final MaxUploadSizeExceededException e) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(body("FILE_TOO_LARGE", "文件过大，请上传不超过 20MB 的回放文件"));
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<Map<String, Object>> handleMultipart(final MultipartException e) {
        return ResponseEntity.badRequest()
                .body(body("MULTIPART_ERROR", "上传请求格式错误"));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, Object>> handleMissingParam(final MissingServletRequestParameterException e) {
        return ResponseEntity.badRequest()
                .body(body("MISSING_PARAM", "缺少必要参数: " + e.getParameterName()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(final ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode())
                .body(body("RESPONSE_STATUS", e.getReason() != null ? e.getReason() : "Unknown error"));
    }

    // ── 管理员 API 异常 ────────────────────────────────────────────
    @ExceptionHandler(AdminBadRequestException.class)
    public ResponseEntity<Map<String, Object>> handleAdminBadRequest(final AdminBadRequestException e) {
        return ResponseEntity.badRequest()
                .body(body(e.getErrorCode(), e.getMessage()));
    }

    @ExceptionHandler(AdminConflictException.class)
    public ResponseEntity<Map<String, Object>> handleAdminConflict(final AdminConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(body(e.getErrorCode(), e.getMessage()));
    }

    @ExceptionHandler(AdminInternalException.class)
    public ResponseEntity<Map<String, Object>> handleAdminInternal(final AdminInternalException e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body(e.getErrorCode(), e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneral(final Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body("INTERNAL_ERROR", "服务器内部错误"));
    }

    // ── 辅助 ────────────────────────────────────────────────────────

    /** 根据错误码返回可读消息。已知错误码返回 English（前端国际化），未知返回原始消息。 */
    private static String resolveMessage(final String error) {
        try {
            return ErrorCode.valueOf(error).getDefaultMessage();
        } catch (final IllegalArgumentException ignored) {
            return error;
        }
    }
}
