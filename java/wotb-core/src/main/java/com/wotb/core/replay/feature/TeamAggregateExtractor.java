package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.util.PlayerResultFormat;

import java.util.Comparator;
import java.util.List;

final class TeamAggregateExtractor {

    private TeamAggregateExtractor() {
    }

    static List<PlayerResult> authoritativeMembers(
            final Battle battle,
            final int perspectiveTeam
    ) {
        if (battle == null || battle.players == null) {
            return List.of();
        }
        return battle.players.stream()
                .filter(player -> player.team == perspectiveTeam)
                .sorted(Comparator.comparingLong((PlayerResult player) -> player.accountId)
                        .thenComparing(player -> player.nickname,
                                Comparator.nullsLast(String::compareTo)))
                .toList();
    }

    static TeamAggregateResult buildAuthoritativeAggregate(
            final Battle battle,
            final List<PlayerResult> members,
            final int perspectiveTeam
    ) {
        if (battle == null || members.isEmpty()) {
            return null;
        }
        final List<Double> deathTimes = members.stream()
                .filter(player -> !player.survived)
                .map(PlayerResultFormat::deathSec)
                .filter(value -> value > 0)
                .sorted()
                .toList();
        return new TeamAggregateResult(
                members.size(),
                members.stream().mapToInt(player -> player.damageDealt).sum(),
                members.stream().mapToInt(player -> player.damageReceived).sum(),
                members.stream().mapToInt(player -> player.damageAssisted).sum(),
                members.stream().mapToInt(player -> player.damageBlocked).sum(),
                members.stream().mapToInt(player -> player.kills).sum(),
                (int) members.stream().filter(player -> player.survived).count(),
                (int) members.stream().filter(player -> !player.survived).count(),
                deathTimes.isEmpty()
                        ? null : deathTimes.stream().mapToDouble(Double::doubleValue).average().orElse(0.0),
                deathTimes.isEmpty() ? null : deathTimes.getFirst(),
                deathTimes.isEmpty() ? null : deathTimes.getLast(),
                resolveAggregateWin(battle, perspectiveTeam));
    }

    static Boolean resolveAggregateWin(final Battle battle, final int perspectiveTeam) {
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, perspectiveTeam);
        return switch (w.winner()) {
            case FRIENDLY_WIN -> Boolean.TRUE;
            case ENEMY_WIN -> Boolean.FALSE;
            case DRAW_OR_UNKNOWN -> null;
        };
    }

    static boolean usableDamageEvidence(
            final DamageEvent damage,
            final TeamEntityIdentity attacker,
            final TeamEntityIdentity victim
    ) {
        return damage.confidence() != DecodeConfidence.UNKNOWN
                && damage.confidence() != DecodeConfidence.PARTIAL
                && attacker != null && attacker.usable()
                && victim != null && victim.usable();
    }

    static TeamObservedAggregate buildObservedAggregate(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedDamages,
            final List<DefaultTeamBattleFeatureExtractor.AttributedHpLoss> teamLosses,
            final int perspectiveTeam,
            final int unattributedCount
    ) {
        int dealt = 0;
        int received = 0;
        int attributed = 0;
        for (final DefaultTeamBattleFeatureExtractor.AttributedHpLoss l : teamLosses) {
            if (l.attacker() != null && l.attacker().team() == perspectiveTeam
                    && l.victim() != null && l.victim().team() != perspectiveTeam) {
                dealt += l.loss().hpLoss();
                attributed++;
            } else if (l.victim() != null && l.victim().team() == perspectiveTeam) {
                received += l.loss().hpLoss();
                if (l.attacker() != null && l.attacker().team() != perspectiveTeam) {
                    attributed++;
                }
            }
        }
        return new TeamObservedAggregate(dealt, received, attributed, unattributedCount);
    }

}