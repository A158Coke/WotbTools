package com.wotb.web.replay.ai.gateway;

import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.AiUpstreamException;

/**
 * å”¯ä¸€çš„ AI ä¸Šæ¸¸ retry å±‚ï¼šåœ¨ {@link SpringAiChatGateway} å†…éƒ¨æ‰§è¡Œï¼Œ
 * SDK æœ¬èº« maxRetries å›ºå®šä¸º 0ï¼Œä¸ä¼šäº§ç”Ÿ retry × retry çš„ä¹˜æ³•ã€‚
 * <p>å¯é‡è¯•ï¼š429ã€è¿žæŽ¥æ•…éšœä¸Žè¶…æ—¶ï¼ˆAI_TIMEOUTï¼‰ã€
 * æ— çŠ¶æ€æˆ– 500/502/503/504 çš„ AI_UPSTREAM_UNAVAILABLEã€‚</p>
 * <p>ä¸å¯é‡è¯•ï¼šè®¤è¯/æƒé™ã€invalid requestã€model not foundã€context too largeã€
 * ç©º/æ— æ•ˆ responseï¼ˆé¿å…å¯¹å·²å»ºå¸çš„å“åº”é‡å¤ä»˜è´¹ï¼‰ã€‚</p>
 */
public record AiRetryPolicy(
        int maxAttempts,
        long initialBackoffMillis,
        long maxBackoffMillis,
        double backoffMultiplier
) {

    public static final AiRetryPolicy DEFAULT = new AiRetryPolicy(3, 1000, 8000, 2.0);

    public AiRetryPolicy {
        if (maxAttempts < 1 || maxAttempts > 5) {
            throw new IllegalArgumentException("maxAttempts must be in [1, 5]: " + maxAttempts);
        }
        if (initialBackoffMillis < 0 || initialBackoffMillis > 60_000) {
            throw new IllegalArgumentException(
                    "initialBackoffMillis must be in [0, 60000]: " + initialBackoffMillis);
        }
        if (maxBackoffMillis < initialBackoffMillis || maxBackoffMillis > 300_000) {
            throw new IllegalArgumentException(
                    "maxBackoffMillis must be in [initialBackoffMillis, 300000]: " + maxBackoffMillis);
        }
        if (backoffMultiplier < 1.0) {
            throw new IllegalArgumentException("backoffMultiplier must be >= 1.0: " + backoffMultiplier);
        }
    }

    public static AiRetryPolicy from(final AiModelProperties properties) {
        return new AiRetryPolicy(
                properties.retryMaxAttempts(),
                properties.retryInitialBackoffMillis(),
                properties.retryMaxBackoffMillis(),
                properties.retryBackoffMultiplier());
    }

    /**
     * ç¬¬ {@code retryNumber} æ¬¡é‡è¯•çš„ç­‰å¾…æ—¶é—´ï¼ˆ1-basedï¼‰ï¼ŒæŒ‰åŸºæ•° Ã— multiplier^(n-1) æ”¾å¤§å¹¶å°é¡¶ã€‚
     */
    public long backoffMillis(final int retryNumber) {
        if (retryNumber < 1) {
            throw new IllegalArgumentException("retryNumber must be >= 1: " + retryNumber);
        }
        final double delay = initialBackoffMillis * Math.pow(backoffMultiplier, retryNumber - 1);
        if (delay >= maxBackoffMillis) {
            return maxBackoffMillis;
        }
        return Math.max(initialBackoffMillis, (long) delay);
    }

    /**
     * å”¯ä¸€çš„å¯é‡è¯•åˆ¤æ–­ï¼Œä¸Ž gateway çš„å®‰å…¨é”™è¯¯ç æ˜ å°„ä¿æŒä¸€è‡´ã€‚
     */
    public boolean isRetryable(final AiUpstreamException error) {
        if (error == null) {
            return false;
        }
        return switch (error.code()) {
            case "AI_RATE_LIMITED", "AI_TIMEOUT" -> true;
            case "AI_UPSTREAM_UNAVAILABLE" ->
                    error.providerStatus() == null || retryableStatus(error.providerStatus());
            default -> false;
        };
    }

    private static boolean retryableStatus(final int status) {
        return status == 500 || status == 502 || status == 503 || status == 504;
    }
}
