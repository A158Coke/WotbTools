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
     * Tolerance for raw vs battle clock consistency check (in seconds).
     * Based on replay timestamp precision: 100ms default tolerance.
     */
    static final float CLOCK_CONSISTENCY_TOLERANCE_SEC = 0.1f;

    /**
     * Resolve battle-relative time from a ReplayTimestamp.
     * Priority: existing battleClockSec > raw - battleStart.
     * Returns empty if neither source can produce a valid relative time,
     * or if raw and battle clock disagree beyond tolerance.
     */
    public Optional<Float> tryRelative(final ReplayTimestamp timestamp) {
        if (timestamp == null) return Optional.empty();
        final Float battle = timestamp.battleClockSec();
        final float raw = timestamp.rawClockSec();
        final boolean hasBattle = battle != null && Float.isFinite(battle) && battle >= 0f;
        final boolean hasRaw = Float.isFinite(raw);

        // 1. Prefer valid battleClockSec
        if (hasBattle) {
            if (hasRaw && resolved()) {
                // Verify consistency: battleClockSec should match raw - start within tolerance
                final float expected = raw - battleStartRawClockSec;
                if (Float.isFinite(expected) && expected >= 0f) {
                    final float diff = Math.abs(battle - expected);
                    if (diff > CLOCK_CONSISTENCY_TOLERANCE_SEC) {
                        // Conflict: clock fields disagree - don't trust either
                        return Optional.empty();
                    }
                }
            }
            return Optional.of(battle);
        }

        // 2. No valid battleClockSec - compute from raw
        if (!resolved()) return Optional.empty();
        if (!hasRaw) return Optional.empty();
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
