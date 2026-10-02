package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;

import java.util.List;

/**
 * Determines battle start time from the reconstruction's resolved battle start, else from
 * a {@code RoundFinishedEvent} (method4/AFTERBATTLE) raw clock minus the settlement duration.
 *
 * <p>PR147/PR162: the single battle-start authority is {@code ReplayReconstruction.battleStartRawClockSec}
 * (originally resolved by {@code ReplayReconstructionService.resolveBattleStartRawClock} — historical Java
 * implementation, retired 2026-10-02 with the server-side parser; the client side derives battle start from
 * the upstream Rust Core WASM {@code parseResult} / canonical facts). {@code ReplayStreamDiagnostics}
 * carries no battle-start authority, so this resolver no longer consults diagnostics.</p>
 */
public final class BattleStartResolver {

    private BattleStartResolver() {}

    public static BattleStartResolution resolve(
            final Float reconstructionBattleStart,
            final List<ReplayEvent> events,
            final Battle battle
    ) {
        if (reconstructionBattleStart != null && Float.isFinite(reconstructionBattleStart)) {
            return BattleStartResolution.fromReconstruction(reconstructionBattleStart);
        }
        if (battle != null && battle.durationS != null && Float.isFinite(battle.durationS.floatValue()) && battle.durationS > 0
                && events != null) {
            for (final ReplayEvent event : events) {
                if (event instanceof RoundFinishedEvent be) {
                    final float raw = be.timestamp().rawClockSec();
                    if (Float.isFinite(raw) && raw >= 0) {
                        final float battleStart = raw - battle.durationS.floatValue();
                        if (Float.isFinite(battleStart) && battleStart >= 0) {
                            return BattleStartResolution.estimated(battleStart);
                        }
                        break;
                    }
                }
            }
        }
        return BattleStartResolution.unresolved();
    }

}
