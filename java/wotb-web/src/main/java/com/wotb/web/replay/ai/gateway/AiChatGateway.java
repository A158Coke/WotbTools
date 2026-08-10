package com.wotb.web.replay.ai.gateway;

/**
 * 项目内部、供应商无关的 AI 聊天网关。
 * <p>Replay 业务服务通过此接口发起 AI 调用， Gateway 实现负责：
 * Provider HTTP 传输、认证、请求体构建、响应解析、错误分类、脱敏、
 * token usage 提取、调用耗时与成功/失败指标记录。</p>
 * <p>GATEWAY 失败时抛出 {@link AiUpstreamException}，携带稳定错误码与
 * {@code correlationId}；不得抛出 Provider 私有异常。</p>
 */
public interface AiChatGateway {

    /**
     * 发送一次聊天请求并返回响应。
     *
     * @param request 供应商无关的请求模型
     * @return 供应商无关的响应模型
     * @throws AiUpstreamException Provider 调用失败或返回异常
     */
    AiChatResponse chat(AiChatRequest request);

    /**
     * 发送一次流式聊天请求：生成内容按段回调 {@code consumer}，
     * 全部完成（或失败断流）后返回聚合响应。
     * <p>语义约定：</p>
     * <ul>
     *     <li>回调与调用同线程、单线程顺序；每段是上游 chunk 文本增量（非累计）</li>
     *     <li>流正常结束时返回的 {@link AiChatResponse#completionText()} 为完整文本，
     *     usage / finishReason 取聚合后最后一个响应 chunk</li>
     *     <li>不做流内重试：失败即断流，已回调部分由调用方自行保留</li>
     *     <li>总预算耗尽 / 外部取消（cancel 端点）时终止流并映射
     *     {@code AI_TIMEOUT} / {@code AI_CANCELLED}（与 {@link #chat} 一致）</li>
     *     <li>{@code consumer} 抛出的异常原样传播并立即终止流</li>
     * </ul>
     * <p>默认实现把非流式网关退化为一次完整文本回调（一次性聚合），
     * 测试替身无需强制实现；生产实现 {@code SpringAiChatGateway} 覆盖为真流式。</p>
     *
     * @param request  供应商无关的请求模型
     * @param consumer 流式增量回调，非 null
     * @return 聚合后的供应商无关响应模型（completionText 为完整文本）
     * @throws AiUpstreamException Provider 调用失败或返回异常
     */
    default AiChatResponse stream(final AiChatRequest request, final StreamConsumer consumer) {
        final AiChatResponse response = chat(request);
        consumer.onDelta(response.completionText());
        return response;
    }

    /**
     * 是否已配置可用凭据。
     *
     * @return {@code true} 表示 Gateway 已具备发起上游调用的凭据
     */
    boolean isConfigured();
}
