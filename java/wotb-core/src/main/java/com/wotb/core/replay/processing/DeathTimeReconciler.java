package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.DeathTimeObservation;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.facts.ReplayTerminalLifecycle;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Canonical live death-time observation.
 *
 * <p>Authority: LIVE_EXACT terminal lifecycle -> SETTLEMENT_SECOND -> UNKNOWN. The live lifecycle is
 * independent from HP amount and therefore includes positive-HP drowning. EntityLeave, last position and
 * damage-threshold heuristics are never death authorities.</p>
 */
public final class DeathTimeReconciler {

    private DeathTimeReconciler() {
    }

    public static Map<Long, DeathTimeObservation> reconcile(
            final Battle battle,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final TeamEntityMapping mapping) {
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return Map.of();
        }
        final Double start = battleStartRawClockSec == null
                ? null : battleStartRawClockSec.doubleValue();
        final Map<Long, ReplayTerminalLifecycle.Evidence> finalLive =
                events == null || events.isEmpty() || mapping == null
                        ? Map.of()
                        : ReplayTerminalLifecycle.finalStateByAccount(events, mapping, start);
        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : Double.POSITIVE_INFINITY;
        final Map<Long, DeathTimeObservation> observations = new HashMap<>();

        for (final PlayerResult player : battle.players) {
            if (player.survived) {
                continue;
            }

            final ReplayTerminalLifecycle.Evidence evidence = finalLive.get(player.accountId);
            if (evidence != null && evidence.terminal()) {
                final double timeSec = Math.min(evidence.timeSec(), duration);
                if (Double.isFinite(timeSec) && timeSec > 0) {
                    observations.put(player.accountId,
                            new DeathTimeObservation(DeathTimeSource.LIVE_EXACT, timeSec));
                }
                continue;
            }

            if (player.deathTimeMillis > 0) {
                // deathTimeMillis is the compatibility projection of settlementLifeTimeSec, derived by
                // ReplayParser from battle_results.dat field24 lifeTime (seconds; the 11.19 corpus has no
                // #104). LIVE_EXACT above already overrides precision; this is the settlement fallback.
                final double timeSec = Math.min(player.deathTimeMillis / 1000.0, duration);
                if (Double.isFinite(timeSec) && timeSec > 0) {
                    observations.put(player.accountId,
                            new DeathTimeObservation(DeathTimeSource.SETTLEMENT_SECOND, timeSec));
                }
                continue;
            }

            // No live observation is emitted when the final lifecycle state is unknown.
        }
        final Map<Long, DeathTimeObservation> result = Map.copyOf(observations);
        battle.liveDeathObservations = result;
        return result;
    }

}
