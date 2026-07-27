package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import java.util.Optional;

public record BattleStartResolution(Status status, Float battleStartRawClockSec, String limitation) {

    public enum Status {
        IDENTIFIED,
        ZERO_CLOCK_INFERRED,
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
            case ZERO_CLOCK_INFERRED -> {
                if (battleStartRawClockSec == null || battleStartRawClockSec != 0f)
                    throw new IllegalArgumentException("ZERO_CLOCK_INFERRED requires clock=0");
                if (limitation != null)
                    throw new IllegalArgumentException("ZERO_CLOCK_INFERRED must have null limitation");
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

    public static BattleStartResolution zeroClockInferred() {
        return new BattleStartResolution(Status.ZERO_CLOCK_INFERRED, 0f, null);
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

    public static BattleStartResolution fromDiagnostics(final ReplayStreamDiagnostics diagnostics) {
        if (diagnostics == null) return unresolved();
        if (diagnostics.battleStartIdentified() && diagnostics.battleStartRawClockSec() != null) {
            return identified(diagnostics.battleStartRawClockSec());
        }
        return inferFromFirstClock(diagnostics.firstClockSec());
    }

    public static BattleStartResolution inferFromFirstClock(final float firstClockSec) {
        if (!Float.isFinite(firstClockSec)) return unresolved();
        if (firstClockSec < 0) return zeroClockInferred();
        return estimated(firstClockSec);
    }

    public boolean resolved() {
        return battleStartRawClockSec != null;
    }

    /**
     * Compute battle-relative time from a raw clock.
     * Returns NaN if unresolved (caller must check resolved()).
     */
    public float battleRelative(final float rawClockSec) {
        if (battleStartRawClockSec == null) return Float.NaN;
        return rawClockSec - battleStartRawClockSec;
    }

    /**
     * Resolve battle-relative time from a ReplayTimestamp.
     * Priority: existing battleClockSec > raw - battleStart.
     * Returns empty if neither source can produce a valid relative time.
     */
    public Optional<Float> tryRelative(final ReplayTimestamp timestamp) {
        if (timestamp == null) return Optional.empty();
        // 1. If battleClockSec already exists and is valid, use it directly
        if (timestamp.battleClockSec() != null
                && Float.isFinite(timestamp.battleClockSec())
                && timestamp.battleClockSec() >= 0f) {
            return Optional.of(timestamp.battleClockSec());
        }
        // 2. Otherwise compute from raw clock (requires resolved battle start)
        if (!resolved()) return Optional.empty();
        final float raw = timestamp.rawClockSec();
        if (!Float.isFinite(raw)) return Optional.empty();
        final float relative = raw - battleStartRawClockSec;
        if (!Float.isFinite(relative) || relative < 0f) return Optional.empty();
        return Optional.of(relative);
    }

    /** Raw clock from timestamp for pre-battle comparison. */
    public static float rawClock(final ReplayTimestamp timestamp) {
        if (timestamp == null) return Float.NaN;
        return timestamp.rawClockSec();
    }

    public boolean isPreBattle(final float rawClockSec) {
        if (battleStartRawClockSec == null) return false;
        return rawClockSec < battleStartRawClockSec;
    }
}
