package com.wotb.web.replay.ai;

import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.core.observability.ApplicationLogger;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import org.slf4j.Logger;
import org.slf4j.event.Level;
import org.springframework.util.StringUtils;

/**
 * AI Review 全链路结构化事件日志工具。
 * <p>统一格式：{@code event=<eventName> correlationId=<cid> key=value key=value}，
 * 与现有 Spring Boot logstash structured logging 兼容，可用 Loki 按
 * {@code |= "event=team_review_validation"} / {@code |= "correlationId=<id>"} 检索。</p>
 *
 * <p>纪律：只记录低基数 metadata；严禁 prompt / completion / reviewMarkdown /
 * API key / 回放原始内容 / 用户隐私文本。correlationId 缺失时输出 {@code -}（直接调用
 * 服务而未设 ThreadLocal context 的测试/本地路径）。</p>
 */
public final class AiReviewEventLog {

    private AiReviewEventLog() {
    }

    public static void info(final Logger logger, final String event, final String correlationId,
                            final Object... fields) {
        log(logger, Level.INFO, event, correlationId, null, fields);
    }

    public static void warn(final Logger logger, final String event, final String correlationId,
                            final Object... fields) {
        log(logger, Level.WARN, event, correlationId, null, fields);
    }

    public static void fallback(final Logger logger, final String event, final Throwable failure,
                                final String path) {
        log(logger, Level.WARN, event, correlationId(), failure,
                "outcome", "degraded", "fallbackPath", path);
    }

    public static void providerFallback(final Logger logger, final String event, final Throwable failure,
                                        final String path) {
        fallback(logger, event, safeAiProviderThrowable(failure), path);
    }

    private static void log(final Logger logger, final Level level, final String event,
                            final String correlationId, final Throwable failure, final Object... fields) {
        final var builder = ApplicationLogger.event(logger, level, event)
                .addKeyValue("correlationId", StringUtils.hasText(correlationId) ? correlationId : correlationId());
        for (int i = 0; i + 1 < fields.length; i += 2) {
            builder.addKeyValue(String.valueOf(fields[i]), fields[i + 1]);
        }
        if (failure != null) {
            builder.setCause(failure);
        }
        builder.log(line(event, correlationId, fields));
    }

    public static void upstreamFailure(final Logger logger, final String event,
                                       final String correlationId, final Throwable cause,
                                       final Object... fields) {
        log(logger, Level.WARN, event, correlationId, safeAiProviderThrowable(cause), fields);
    }

    private static Throwable safeAiProviderThrowable(final Throwable failure) {
        if (failure instanceof AiUpstreamException upstream) {
            // The application-owned root is a stable code. Only its provider cause is untrusted.
            if (upstream.getCause() == null && upstream.getSuppressed().length == 0) return upstream;
            final AiUpstreamException safe = new AiUpstreamException(upstream.code(), upstream.providerStatus(),
                    upstream.correlationId(), ApplicationLogger.safeProviderThrowable(upstream.getCause()));
            safe.setStackTrace(upstream.getStackTrace());
            for (final Throwable suppressed : upstream.getSuppressed()) {
                safe.addSuppressed(ApplicationLogger.safeProviderThrowable(suppressed));
            }
            return safe;
        }
        return ApplicationLogger.safeProviderThrowable(failure);
    }

    /** 当前线程的 correlationId（由 Controller worker 设置），缺失时为 {@code -}。 */
    public static String correlationId() {
        final String cid = AiRequestContext.correlationId();
        return StringUtils.hasText(cid) ? cid : "-";
    }

    /**
     * 拼装结构化日志行：{@code event=... correlationId=... k=v k=v}。
     * <p>{@code kv} 为扁平 key/value 对（奇数长度按 key-only 处理）。
     * 显式 correlationId 优先（Gateway 等自行解析 id 的组件传入），否则回退 ThreadLocal。</p>
     */
    private static String line(final String event, final String correlationId, final Object... kv) {
        final StringBuilder sb = new StringBuilder("event=").append(event);
        sb.append(" correlationId=").append(StringUtils.hasText(correlationId) ? correlationId : correlationId());
        for (int i = 0; i + 1 < kv.length; i += 2) {
            sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        }
        return sb.toString();
    }
}
