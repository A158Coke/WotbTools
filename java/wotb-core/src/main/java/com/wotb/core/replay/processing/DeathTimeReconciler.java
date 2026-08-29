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
                events == null || events.isEmpty() || mapping == null
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
                // deathTimeMillis is the canonical SETTLEMENT_SECOND quantity, derived by
                // ReplayParser from battle_results.dat field24 lifeTime (seconds; the 11.19 corpus has no
                // #104). LIVE_EXACT above already overrides precision; this is the settlement fallback.
                final double st = player.deathTimeMillis / 1000.0;
                player.survivalTimeSec = st > 0 ? Math.min(st, duration) : 0;
                player.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
                continue;
            }

            if (evidence != null || hasAuthoritativeMapping(player, mapping)) {
                // We had an authoritative live identity surface but no final terminal: the time is unknown.
                player.survivalTimeSec = 0;
                player.deathTimeSource = DeathTimeSource.UNKNOWN;
            }
            // No trustworthy mapping/evidence: fail closed by leaving the model untouched. Consumers must
            // honor deathTimeSource and never reinterpret a legacy survivalTimeSec as an authoritative death.
        }
    }

    private static boolean hasAuthoritativeMapping(
            final PlayerResult player,
            final TeamEntityMapping mapping) {
        if (mapping == null || player == null) {
            return false;
        }
        return !mapping.entityIds(player.accountId, player.nickname).isEmpty();
    }
}
