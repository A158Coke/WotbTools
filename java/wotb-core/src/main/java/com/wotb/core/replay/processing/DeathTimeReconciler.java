package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.facts.ReplayTerminalLifecycle;

import java.util.List;
import java.util.Map;

/**
 * Canonical death-time reconciliation.
 *
 * <p>Authority: LIVE_EXACT terminal lifecycle -> SETTLEMENT_SECOND -> UNKNOWN. The live lifecycle is
 * independent from HP amount and therefore includes positive-HP drowning. EntityLeave, last position and
 * damage-threshold heuristics are never death authorities.</p>
 */
public final class DeathTimeReconciler {

    private DeathTimeReconciler() {
    }

    public static void reconcile(
            final Battle battle,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final TeamEntityMapping mapping) {
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return;
        }
        final Double start = battleStartRawClockSec == null
                ? null : battleStartRawClockSec.doubleValue();
        final Map<Long, ReplayTerminalLifecycle.Evidence> finalLive =
                events == null || mapping == null
                        ? Map.of()
                        : ReplayTerminalLifecycle.finalStateByAccount(events, mapping, start);
        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : Double.POSITIVE_INFINITY;

        for (final PlayerResult player : battle.players) {
            if (player.survived) {
                continue;
            }
            final ReplayTerminalLifecycle.Evidence evidence = finalLive.get(player.accountId);
            if (evidence != null && evidence.terminal()) {
                player.survivalTimeSec = Math.min(evidence.timeSec(), duration);
                player.deathTimeSource = DeathTimeSource.LIVE_EXACT;
                continue;
            }
            if (player.deathTimeMillis > 0) {
                final double st = player.deathTimeMillis / 1000.0;
                player.survivalTimeSec = st > 0 ? Math.min(st, duration) : 0;
                player.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
            } else {
                player.survivalTimeSec = 0;
                player.deathTimeSource = DeathTimeSource.UNKNOWN;
            }
        }
    }
}
