package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;

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

    static boolean isLowConfidence(final DecodeConfidence c) {
        return c == null || ordinal(c) >= ordinal(DecodeConfidence.PARTIAL);
    }
}
