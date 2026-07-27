package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

import java.util.List;

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

    public static BattleStartResolution resolve(
            final Float reconstructionBattleStart,
            final ReplayStreamDiagnostics diagnostics,
            final List<ReplayEvent> events,
            final Battle battle
    ) {
        if (reconstructionBattleStart != null && Float.isFinite(reconstructionBattleStart)) {
            return BattleStartResolution.fromReconstruction(reconstructionBattleStart);
        }
        if (diagnostics != null) {
            return BattleStartResolution.fromDiagnostics(diagnostics);
        }
        if (battle != null && battle.durationS != null && Float.isFinite(battle.durationS.floatValue()) && battle.durationS > 0
                && events != null) {
            for (final ReplayEvent event : events) {
                if (event instanceof BattleEndedEvent be) {
                    final float raw = be.timestamp().rawClockSec();
                    if (Float.isFinite(raw) && raw >= 0) {
                        final float battleStart = raw - battle.durationS.floatValue();
                        if (Float.isFinite(battleStart) && battleStart >= 0) {
                            return BattleStartResolution.estimated(battleStart);
                        }
                    }
                    break;
                }
            }
        }
        return BattleStartResolution.unresolved();
    }

}
