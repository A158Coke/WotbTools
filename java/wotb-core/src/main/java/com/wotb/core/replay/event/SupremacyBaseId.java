package com.wotb.core.replay.event;

public enum SupremacyBaseId {
    A, B, C, D;

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
