package com.wotb.core.ai;

import java.util.List;
import java.util.Map;

/**
 * Token estimator for AI prompt messages.
 * Implementations must clearly state whether they provide exact or estimated counts.
 */
public interface AiTokenEstimator {

    /** Estimate total tokens for a list of messages (system + user turns). */
    int estimateMessagesTokens(List<Map<String, Object>> messages);

    /** Estimate tokens for a single text string. */
    int estimateTextTokens(String text);
}
