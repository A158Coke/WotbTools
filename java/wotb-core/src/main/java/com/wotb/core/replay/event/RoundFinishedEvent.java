package com.wotb.core.replay.event;

public record RoundFinishedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int winnerTeam,
        int finishReasonRaw,
        FinishCause finishCause
) implements ReplayEvent {

    public enum FinishCause {
        ELIMINATION,
        SUPREMACY_1000,
        UNKNOWN
    }

    public static FinishCause causeOf(final int raw) {
        return switch (raw) {
            case 1 -> FinishCause.ELIMINATION;
            case 6 -> FinishCause.SUPREMACY_1000;
            default -> FinishCause.UNKNOWN;
        };
    }
}
