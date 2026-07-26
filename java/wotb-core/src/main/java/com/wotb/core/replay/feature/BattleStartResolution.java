package com.wotb.core.replay.feature;

import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

/**
 * Result of battle-start resolution with status and limitation.
 * Priority order: IDENTIFIED > ZERO_CLOCK_INFERRED > ESTIMATED > UNRESOLVED.
 */
public record BattleStartResolution(
        Status status,
        Float battleStartRawClockSec,
        String limitation
) {
    public enum Status {
        IDENTIFIED,
        ZERO_CLOCK_INFERRED,
        ESTIMATED,
        UNRESOLVED
    }

    public BattleStartResolution {
        if (status == null) throw new IllegalArgumentException("status must not be null");
        if (status == Status.UNRESOLVED) {
            battleStartRawClockSec = null;
        }
    }

    public boolean resolved() {
        return battleStartRawClockSec != null;
    }

    public static BattleStartResolution fromDiagnostics(final ReplayStreamDiagnostics diagnostics) {
        if (diagnostics == null) return unresolved();
        if (diagnostics.battleStartIdentified() && diagnostics.battleStartRawClockSec() != null) {
            return new BattleStartResolution(Status.IDENTIFIED, diagnostics.battleStartRawClockSec(), null);
        }
        return inferFromFirstClock(diagnostics.firstClockSec());
    }

    public static BattleStartResolution inferFromFirstClock(final float firstClockSec) {
        if (!Float.isFinite(firstClockSec)) {
            return new BattleStartResolution(Status.UNRESOLVED, null, "PRE_BATTLE_START_UNRESOLVED");
        }
        if (firstClockSec < 0) {
            return new BattleStartResolution(Status.ZERO_CLOCK_INFERRED, 0f, null);
        }
        return new BattleStartResolution(Status.ESTIMATED, firstClockSec, "PRE_BATTLE_START_ESTIMATED");
    }

    public static BattleStartResolution unresolved() {
        return new BattleStartResolution(Status.UNRESOLVED, null, "PRE_BATTLE_START_UNRESOLVED");
    }

    public float battleRelative(final float rawClockSec) {
        if (battleStartRawClockSec == null) return rawClockSec;
        return rawClockSec - battleStartRawClockSec;
    }

    public boolean isPreBattle(final float rawClockSec) {
        if (battleStartRawClockSec == null) return false;
        return rawClockSec < battleStartRawClockSec;
    }
}
