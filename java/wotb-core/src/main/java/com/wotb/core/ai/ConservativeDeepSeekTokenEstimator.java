package com.wotb.core.ai;

import java.util.List;
import java.util.Map;

/**
 * Conservative token estimator for DeepSeek models.
 * Uses character-based estimation as an approximation:
 *   estimatedTokens = ceil(codePoints * 1.25)
 * plus fixed per-message envelope overhead.
 * This is a CONSERVATIVE estimate, NOT exact token counting.
 * May overestimate for English/Latin text, near-accurate for CJK.
 * Always paired with a safety margin to prevent context overflow.
 */
public final class ConservativeDeepSeekTokenEstimator implements AiTokenEstimator {

    private static final int ENVELOPE_CHARS_PER_MESSAGE = 32; // role + formatting overhead

    @Override
    public int estimateMessagesTokens(List<Map<String, Object>> messages) {
        if (messages == null || messages.isEmpty()) return 0;
        int total = 0;
        for (final Map<String, Object> msg : messages) {
            total += ENVELOPE_CHARS_PER_MESSAGE;
            for (final Map.Entry<String, Object> entry : msg.entrySet()) {
                if (entry.getValue() instanceof String s) {
                    total += estimateTextTokens(s);
                }
            }
        }
        return total;
    }

    @Override
    public int estimateTextTokens(String text) {
        if (text == null || text.isEmpty()) return 0;
        final int codePoints = text.codePointCount(0, text.length());
        return Math.max(1, (int) Math.ceil(codePoints * 1.25));
    }
}
