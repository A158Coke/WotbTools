package com.wotb.web.replay.ai;

/**
 * 调用上游 AI 服务（DeepSeek）失败时抛出。
 * 由 {@code ReconstructionController} 映射为 502 响应，消息为稳定错误码，
 * 不包含任何密钥或敏感信息。
 */
public class AiUpstreamException extends RuntimeException {
    public AiUpstreamException(String message) {
        super(message);
    }
}
