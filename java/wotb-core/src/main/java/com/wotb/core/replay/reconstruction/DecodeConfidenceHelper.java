package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 解码置信度比较辅助。
 */
final class DecodeConfidenceHelper {
    private DecodeConfidenceHelper() {}

    static int ordinal(DecodeConfidence c) {
        return switch (c) {
            case EXACT -> 0;
            case INFERRED -> 1;
            case PARTIAL -> 2;
            case UNKNOWN -> 3;
        };
    }
}
