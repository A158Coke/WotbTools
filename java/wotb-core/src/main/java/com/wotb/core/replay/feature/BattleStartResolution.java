package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.ReplayTimestamp;
public record BattleStartResolution(Status status, Float battleStartRawClockSec, String limitation) {

    public enum Status {
        IDENTIFIED,
        ESTIMATED,
        UNRESOLVED
    }

    public BattleStartResolution {
        if (status == null) throw new IllegalArgumentException("status must not be null");
        switch (status) {
            case IDENTIFIED -> {
                if (battleStartRawClockSec == null || !Float.isFinite(battleStartRawClockSec))
                    throw new IllegalArgumentException("IDENTIFIED requires finite clock");
                if (limitation != null)
                    throw new IllegalArgumentException("IDENTIFIED must have null limitation");
            }
            case ESTIMATED -> {
                if (battleStartRawClockSec == null || !Float.isFinite(battleStartRawClockSec))
                    throw new IllegalArgumentException("ESTIMATED requires finite clock");
                if (!"PRE_BATTLE_START_ESTIMATED".equals(limitation))
                    throw new IllegalArgumentException("ESTIMATED requires PRE_BATTLE_START_ESTIMATED limitation");
            }
            case UNRESOLVED -> {
                if (battleStartRawClockSec != null)
                    throw new IllegalArgumentException("UNRESOLVED must have null clock");
                if (!"PRE_BATTLE_START_UNRESOLVED".equals(limitation))
                    throw new IllegalArgumentException("UNRESOLVED requires PRE_BATTLE_START_UNRESOLVED limitation");
            }
        }
    }

    public static BattleStartResolution identified(final float clockSec) {
        return new BattleStartResolution(Status.IDENTIFIED, clockSec, null);
    }

    public static BattleStartResolution estimated(final float clockSec) {
        return new BattleStartResolution(Status.ESTIMATED, clockSec, "PRE_BATTLE_START_ESTIMATED");
    }

    public static BattleStartResolution unresolved() {
        return new BattleStartResolution(Status.UNRESOLVED, null, "PRE_BATTLE_START_UNRESOLVED");
    }

    public static BattleStartResolution fromReconstruction(final Float battleStartRawClockSec) {
        if (battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)) {
            return identified(battleStartRawClockSec);
        }
        return unresolved();
    }

    public boolean resolved() {
        return battleStartRawClockSec != null;
    }

    /** Tolerance for raw vs battle clock consistency check (in seconds). */
    static final float CLOCK_CONSISTENCY_TOLERANCE_SEC = 0.1f;

    public TacticalTimeResolution tryRelative(final ReplayTimestamp timestamp) {
        if (timestamp == null) {
            return TacticalTimeResolution.invalidTimestamp();
        }

        final Float battle = timestamp.battleClockSec();
        final float raw = timestamp.rawClockSec();
        final boolean rawAvailable = Float.isFinite(raw) && raw >= 0f;

        if (battle != null && (!Float.isFinite(battle) || battle < 0f)) {
            return TacticalTimeResolution.invalidTimestamp();
        }

        if (battle != null && Float.isFinite(battle) && battle >= 0f) {
            if (rawAvailable && resolved()) {
                final float expected = raw - battleStartRawClockSec;
                if (expected < 0f) {
                    return TacticalTimeResolution.clockConflict();
                }
                if (Math.abs(battle - expected) > CLOCK_CONSISTENCY_TOLERANCE_SEC) {
                    return TacticalTimeResolution.clockConflict();
                }
            }
            return TacticalTimeResolution.usable(battle);
        }

        if (!rawAvailable) {
            return TacticalTimeResolution.invalidTimestamp();
        }
        if (!resolved()) {
            return TacticalTimeResolution.unresolvedRawOnly();
        }
        if (raw < battleStartRawClockSec) {
            return TacticalTimeResolution.preBattle();
        }
        return TacticalTimeResolution.usable(raw - battleStartRawClockSec);
    }

}
