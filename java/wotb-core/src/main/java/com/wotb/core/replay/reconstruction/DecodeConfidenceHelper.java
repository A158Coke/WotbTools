package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 解码置信度比较辅助。
 */
final class DecodeConfidenceHelper {
    private DecodeConfidenceHelper() {}

    static int ordinal(final DecodeConfidence c) {
        return switch (c) {
            case EXACT -> 0;
            case INFERRED -> 1;
            case PARTIAL -> 2;
            case UNKNOWN -> 3;
        };
    }

    /** true if confidence is low enough that it should not override known state. */
    static boolean isLowConfidence(final DecodeConfidence c) {
        return c == null || ordinal(c) >= ordinal(DecodeConfidence.PARTIAL);
    }

    /** true if confidence is at least as reliable as the given threshold. */
    static boolean atLeast(final DecodeConfidence c, final DecodeConfidence threshold) {
        return c != null && ordinal(c) <= ordinal(threshold);
    }
}
