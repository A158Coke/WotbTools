package com.wotb.web.replay.ai.gateway;

import com.wotb.web.replay.ai.AiUpstreamException;

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
     * 是否已配置可用凭据。
     *
     * @return {@code true} 表示 Gateway 已具备发起上游调用的凭据
     */
    boolean isConfigured();
}