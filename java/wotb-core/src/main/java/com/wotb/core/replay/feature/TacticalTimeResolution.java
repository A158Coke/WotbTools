package com.wotb.core.replay.feature;

public record TacticalTimeResolution(Status status, Float battleRelativeSec, String limitation) {

    public enum Status {
        USABLE,
        PRE_BATTLE,
        INVALID_TIMESTAMP,
        CLOCK_CONFLICT,
        UNRESOLVED_RAW_ONLY
    }

    public TacticalTimeResolution {
        if (status == null) throw new IllegalArgumentException("status must not be null");
        switch (status) {
            case USABLE -> {
                if (battleRelativeSec == null || !Float.isFinite(battleRelativeSec) || battleRelativeSec < 0f)
                    throw new IllegalArgumentException("USABLE requires finite non-negative battle-relative time");
            }
            case PRE_BATTLE, CLOCK_CONFLICT, UNRESOLVED_RAW_ONLY -> {
                if (battleRelativeSec != null)
                    throw new IllegalArgumentException(status + " must have null battleRelativeSec");
                if (limitation == null)
                    throw new IllegalArgumentException(status + " requires non-null limitation");
            }
            case INVALID_TIMESTAMP -> {
                if (battleRelativeSec != null)
                    throw new IllegalArgumentException(status + " must have null battleRelativeSec");
            }
        }
    }

    public static TacticalTimeResolution usable(final float battleRelativeSec) {
        return new TacticalTimeResolution(Status.USABLE, battleRelativeSec, null);
    }

    public static TacticalTimeResolution preBattle() {
        return new TacticalTimeResolution(Status.PRE_BATTLE, null, "PRE_BATTLE_POSITION_IGNORED");
    }

    public static TacticalTimeResolution invalidTimestamp() {
        return new TacticalTimeResolution(Status.INVALID_TIMESTAMP, null, null);
    }

    public static TacticalTimeResolution clockConflict() {
        return new TacticalTimeResolution(Status.CLOCK_CONFLICT, null, "EVENT_CLOCK_CONFLICT_IGNORED");
    }

    public static TacticalTimeResolution unresolvedRawOnly() {
        return new TacticalTimeResolution(Status.UNRESOLVED_RAW_ONLY, null, "UNRESOLVED_RAW_ONLY_EVENTS_IGNORED");
    }

    public boolean isUsable() {
        return status == Status.USABLE;
    }
}
