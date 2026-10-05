package com.wotb.ai;

import com.wotb.web.util.apierror.ApiErrorResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;

/**
 * 把 {@link AiReviewController} 在返回 SSE 流之前抛出的失败映射为契约的 {@code ApiError} envelope，
 * 使客户端始终拿到稳定 {@code errorCode}（而不是 Spring 默认的 {@code {timestamp,status,error,path}}）。
 *
 * <p>只有「提交 worker 之前」的失败会到达这里（信封校验 / 准入饱和 / 请求体上限）；进入 worker 后的
 * 运行时与业务失败仍以 SSE {@code error} 事件传达，见 {@code docs/architecture/ai-review.md}。</p>
 *
 * <p>限定到 {@link AiReviewController}，避免影响 Actuator 等其它端点的错误语义。</p>
 */
@RestControllerAdvice(assignableTypes = AiReviewController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AiReviewExceptionHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReviewExceptionHandler.class);

    /** 仅 503（有界准入饱和）具备重试语义；信封/语义错误一律不可重试。 */
    private static final int SERVICE_UNAVAILABLE = 503;

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiErrorResponse> handleResponseStatus(final ResponseStatusException error) {
        final int status = error.getStatusCode().value();
        final String errorCode = error.getReason() == null ? "INVALID_REQUEST" : error.getReason();
        LOGGER.info("ai_review_rejected errorCode={} status={}", errorCode, status);
        return ResponseEntity.status(status).body(new ApiErrorResponse(
                null, errorCode, null, status, status == SERVICE_UNAVAILABLE, Map.of(), Instant.now()));
    }

    static void writeSecurityError(final HttpServletResponse response, final int status,
                                   final String errorCode) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        JsonMapper.builder().build().writeValue(response.getOutputStream(), new ApiErrorResponse(
                null, errorCode, null, status, false, Map.of(), Instant.now()));
    }
}
