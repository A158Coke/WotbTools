package com.wotb.web.replay.ai.gateway;

/**
 * 流式输出回调：{@link AiChatGateway#stream} 逐段（token 级 delta）回调。
 * <p>回调发生在发起调用的线程上，保证单线程顺序；回调抛出的
 * {@link RuntimeException} 会立即终止流并原样传播（不做错误映射），
 * 用于调用方（如 SSE 发送失败 / 客户端断开）主动断流。</p>
 */
@FunctionalInterface
public interface StreamConsumer {

    /**
     * 收到一段流式输出增量（与上游 chunk 文本一致，非累计）。
     *
     * @param delta 文本增量，非 null；可能为空字符串（纯元数据 chunk）
     */
    void onDelta(String delta);
}
