package com.wotb.ai.gateway;

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
