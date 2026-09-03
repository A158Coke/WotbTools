package com.wotb.core.replay.event;

/** Stable domain identity for a Supremacy base. */
public enum SupremacyBaseId {
    A, B, C, D;

    /** Convert the protocol's zero-based index at the backend boundary only. */
    public static SupremacyBaseId fromProtocolIndex(final int index) {
        return switch (index) {
            case 0 -> A;
            case 1 -> B;
            case 2 -> C;
            case 3 -> D;
            default -> throw new IllegalArgumentException("unsupported Supremacy base index: " + index);
        };
    }
}
