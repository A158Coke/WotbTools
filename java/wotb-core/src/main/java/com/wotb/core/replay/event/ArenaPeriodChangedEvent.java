package com.wotb.core.replay.event;

public record ArenaPeriodChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int periodRaw,
        Period period
) implements ReplayEvent {

    public enum Period {
        IDLE,
        WAITING,
        PREBATTLE,
        BATTLE,
        AFTERBATTLE,
        UNKNOWN
    }

    public static Period periodOf(final int raw) {
        return switch (raw) {
            case 0 -> Period.IDLE;
            case 1 -> Period.WAITING;
            case 2 -> Period.PREBATTLE;
            case 3 -> Period.BATTLE;
            case 4 -> Period.AFTERBATTLE;
            default -> Period.UNKNOWN;
        };
    }
}
