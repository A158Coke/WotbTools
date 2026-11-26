package com.wotb.ai.review;

import com.wotb.ai.gateway.AiCancellationToken;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

@Component
public class AiCancellationRegistry {

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final ConcurrentHashMap<String, AiCancellationToken> active = new ConcurrentHashMap<>();

    /**
     * Registers a fresh token for {@code correlationId}.
     *
     * <p>仅接受 canonical UUID（格式 + 长度）；非 UUID 返回 {@code null}。同一 id 已活跃时
     * 拒绝（返回 {@code null}），不复用 token——两个请求永远不会共享同一个取消信号。</p>
     *
     * @return 新 token；id 非法或已占用时返回 {@code null}
     */
    public AiCancellationToken register(final String correlationId) {
        if (!isValidCorrelationId(correlationId)) {
            return null;
        }
        final AiCancellationToken created = new AiCancellationToken();
        final AiCancellationToken existing = active.putIfAbsent(correlationId, created);
        return existing != null ? null : created;
    }

    /**
     * Cancels the in-flight request identified by {@code correlationId}.
     *
     * @return {@code true} if the request was registered (whether or not it was
     *         already cancelled)
     */
    public boolean cancel(final String correlationId) {
        final AiCancellationToken token = active.get(correlationId);
        if (token == null) {
            return false;
        }
        token.cancel();
        return true;
    }

    public void unregister(final String correlationId, final AiCancellationToken token) {
        if (token != null) {
            active.remove(correlationId, token);
        }
    }

    public static boolean isValidCorrelationId(final String correlationId) {
        return correlationId != null && UUID_PATTERN.matcher(correlationId).matches();
    }
}
