package com.wotb.core.replay.feature;

import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

/**
 * Determines battle start time from replay diagnostics.
 * Delegates to {@link BattleStartResolution} for status modeling.
 */
public final class BattleStartResolver {

    private BattleStartResolver() {}

    public static final String PRE_BATTLE_START_UNRESOLVED = "PRE_BATTLE_START_UNRESOLVED";
    public static final String PRE_BATTLE_START_ESTIMATED = "PRE_BATTLE_START_ESTIMATED";

    public static BattleStartResolution resolve(final ReplayStreamDiagnostics diagnostics) {
        return BattleStartResolution.fromDiagnostics(diagnostics);
    }

    public static BattleStartResolution inferFromFirstClock(final float firstClockSec) {
        return BattleStartResolution.inferFromFirstClock(firstClockSec);
    }

    @Deprecated
    public static Float resolveStart(final ReplayStreamDiagnostics diagnostics) {
        final BattleStartResolution r = resolve(diagnostics);
        return r.battleStartRawClockSec();
    }

    @Deprecated
    public static Float inferFromFirstClockDeprecated(final float firstClockSec) {
        if (!Float.isFinite(firstClockSec)) return null;
        if (firstClockSec < 0) return 0f;
        return firstClockSec;
    }

    @Deprecated
    public static float battleRelative(final float rawClockSec, final Float battleStartRawClockSec) {
        if (battleStartRawClockSec != null) return rawClockSec - battleStartRawClockSec;
        return rawClockSec;
    }

    @Deprecated
    public static boolean isPreBattle(final float rawClockSec, final Float battleStartRawClockSec) {
        if (battleStartRawClockSec == null) return false;
        return rawClockSec < battleStartRawClockSec;
    }
}
