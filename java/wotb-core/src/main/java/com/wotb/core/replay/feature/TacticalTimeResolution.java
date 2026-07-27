package com.wotb.core.replay.feature;

public record TacticalTimeResolution(Status status, Float battleRelativeSec, String limitation) {

    public static final String INVALID_EVENT_TIMESTAMPS_IGNORED = "INVALID_EVENT_TIMESTAMPS_IGNORED";
    public static final String EVENT_CLOCK_CONFLICT_IGNORED = "EVENT_CLOCK_CONFLICT_IGNORED";
    public static final String UNRESOLVED_RAW_ONLY_EVENTS_IGNORED = "UNRESOLVED_RAW_ONLY_EVENTS_IGNORED";

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
                if (limitation != null)
                    throw new IllegalArgumentException("USABLE must have null limitation");
            }
            case PRE_BATTLE -> {
                if (battleRelativeSec != null)
                    throw new IllegalArgumentException(status + " must have null battleRelativeSec");
                if (limitation != null)
                    throw new IllegalArgumentException(status + " must have null limitation");
            }
            case INVALID_TIMESTAMP -> {
                if (battleRelativeSec != null)
                    throw new IllegalArgumentException(status + " must have null battleRelativeSec");
                if (!INVALID_EVENT_TIMESTAMPS_IGNORED.equals(limitation))
                    throw new IllegalArgumentException(status + " requires limitation=" + INVALID_EVENT_TIMESTAMPS_IGNORED);
            }
            case CLOCK_CONFLICT -> {
                if (battleRelativeSec != null)
                    throw new IllegalArgumentException(status + " must have null battleRelativeSec");
                if (!EVENT_CLOCK_CONFLICT_IGNORED.equals(limitation))
                    throw new IllegalArgumentException(status + " requires limitation=" + EVENT_CLOCK_CONFLICT_IGNORED);
            }
            case UNRESOLVED_RAW_ONLY -> {
                if (battleRelativeSec != null)
                    throw new IllegalArgumentException(status + " must have null battleRelativeSec");
                if (!UNRESOLVED_RAW_ONLY_EVENTS_IGNORED.equals(limitation))
                    throw new IllegalArgumentException(status + " requires limitation=" + UNRESOLVED_RAW_ONLY_EVENTS_IGNORED);
            }
        }
    }

    public static TacticalTimeResolution usable(final float battleRelativeSec) {
        return new TacticalTimeResolution(Status.USABLE, battleRelativeSec, null);
    }

    public static TacticalTimeResolution preBattle() {
        return new TacticalTimeResolution(Status.PRE_BATTLE, null, null);
    }

    public static TacticalTimeResolution invalidTimestamp() {
        return new TacticalTimeResolution(Status.INVALID_TIMESTAMP, null, INVALID_EVENT_TIMESTAMPS_IGNORED);
    }

    public static TacticalTimeResolution clockConflict() {
        return new TacticalTimeResolution(Status.CLOCK_CONFLICT, null, EVENT_CLOCK_CONFLICT_IGNORED);
    }

    public static TacticalTimeResolution unresolvedRawOnly() {
        return new TacticalTimeResolution(Status.UNRESOLVED_RAW_ONLY, null, UNRESOLVED_RAW_ONLY_EVENTS_IGNORED);
    }

    public boolean isUsable() {
        return status == Status.USABLE;
    }
}
