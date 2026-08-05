package com.wotb.web.replay.ai.gateway;

import java.util.Map;

/**
 * 供应商无关的 AI 聊天响应模型，由 Gateway 实现从 Provider 响应映射而来。
 * <p>所有 token 字段在 Provider 未返回时为 0；{@code finishReason} 在未返回时为 {@code null}。
 * 业务层不应在此对象之外接触任何 Provider DTO。</p>
 *
 * @param completionText    生成的文本（必填非空）
 * @param provider          Provider 标识，如 {@code "DeepSeek"}
 * @param model             实际使用的模型名
 * @param inputTokens       输入 token 数
 * @param outputTokens      输出 token 数
 * @param totalTokens       总 token 数
 * @param reasoningTokens   推理 token 数（Provider 未返回时为 0）
 * @param cacheHitTokens    命中缓存 token 数（Provider 未返回时为 0）
 * @param cacheMissTokens   未命中缓存 token 数（Provider 未返回时为 0）
 * @param finishReason      终止原因（如 {@code "stop"}），可为 {@code null}
 * @param metadata          低风险附加元数据，可为 {@code null}
 */
public record AiChatResponse(
        String completionText,
        String provider,
        String model,
        int inputTokens,
        int outputTokens,
        int totalTokens,
        int reasoningTokens,
        int cacheHitTokens,
        int cacheMissTokens,
        String finishReason,
        Map<String, String> metadata
) {
    public AiChatResponse {
        if (completionText == null) throw new IllegalArgumentException("completionText must not be null");
        provider = provider == null ? "" : provider;
        model = model == null ? "" : model;
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}