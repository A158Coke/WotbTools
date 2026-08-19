package com.wotb.web.replay.ai.gateway;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Registry of in-flight AI Review requests keyed by correlation id, so the
 * cancel endpoint can abort an upstream call that the client no longer waits
 * for. This is what turns a client abort (navigation / cancel button / client
 * timeout) into an immediate upstream cancellation instead of a wasted,
 * fully-billed AI call.
 */
@Component
public class AiCancellationRegistry {

    /**
     * Canonical UUID correlation id（格式 + 长度 36）：客户端提供的 id 必须匹配。
     */
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
     * already cancelled)
     */
    public boolean cancel(final String correlationId) {
        final AiCancellationToken token = active.get(correlationId);
        if (token == null) {
            return false;
        }
        token.cancel();
        return true;
    }

    /**
     * 仅当映射仍指向 {@code token} 时删除（compare-and-remove）：已完成的请求不会误删
     * 复用同一 id 的新注册。
     */
    public void unregister(final String correlationId, final AiCancellationToken token) {
        if (token != null) {
            active.remove(correlationId, token);
        }
    }

    /**
     * 客户端提供的 correlationId 校验：canonical UUID（格式 + 长度 36）。
     */
    public static boolean isValidCorrelationId(final String correlationId) {
        return correlationId != null && UUID_PATTERN.matcher(correlationId).matches();
    }
}
