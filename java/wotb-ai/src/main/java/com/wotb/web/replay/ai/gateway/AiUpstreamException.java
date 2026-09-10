package com.wotb.web.replay.ai.gateway;

/**
 * 调用上游 AI 服务（DeepSeek）失败时抛出。
 * 由 {@code ReconstructionController} 映射为 502 响应，消息为稳定错误码，
 * 不包含任何密钥或敏感信息。
 */
public class AiUpstreamException extends RuntimeException {

    private final String code;
    private final Integer providerStatus;
    private final String correlationId;

    public AiUpstreamException(
            final String code,
            final Integer providerStatus,
            final String correlationId
    ) {
        super(code);
        this.code = code;
        this.providerStatus = providerStatus;
        this.correlationId = correlationId;
    }

    public AiUpstreamException(
            final String code,
            final Integer providerStatus,
            final String correlationId,
            final Throwable cause
    ) {
        super(code, cause);
        this.code = code;
        this.providerStatus = providerStatus;
        this.correlationId = correlationId;
    }

    public String code() {
        return code;
    }

    public Integer providerStatus() {
        return providerStatus;
    }

    public String correlationId() {
        return correlationId;
    }
}
