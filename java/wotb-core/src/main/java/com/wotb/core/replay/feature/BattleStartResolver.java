package com.wotb.core.replay.feature;

import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

/**
 * Determines battle start time from replay diagnostics.
 * Delegates to {@link BattleStartResolution}.
 */
public final class BattleStartResolver {

    private BattleStartResolver() {}

    public static BattleStartResolution resolve(final Float reconstructionBattleStart, final ReplayStreamDiagnostics diagnostics) {
        if (reconstructionBattleStart != null && Float.isFinite(reconstructionBattleStart)) {
            return BattleStartResolution.fromReconstruction(reconstructionBattleStart);
        }
        if (diagnostics != null) {
            return BattleStartResolution.fromDiagnostics(diagnostics);
        }
        return BattleStartResolution.unresolved();
    }

    public static BattleStartResolution inferFromFirstClock(final float firstClockSec) {
        return BattleStartResolution.inferFromFirstClock(firstClockSec);
    }
}
