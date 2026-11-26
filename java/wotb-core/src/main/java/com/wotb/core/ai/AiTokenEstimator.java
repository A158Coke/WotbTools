package com.wotb.core.ai;

import java.util.List;
import java.util.Map;

public interface AiTokenEstimator {

    int estimateMessagesTokens(List<Map<String, Object>> messages);

    int estimateTextTokens(String text);
}
