package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.util.PlayerResultFormat;

import java.util.Comparator;
import java.util.List;

/**
 * 团队权威/观测聚合提取器：名册、权威 TeamAggregateResult、胜负判定、观测聚合与伤害证据门禁。
 * <p>从 {@link DefaultTeamBattleFeatureExtractor} 拆出，纯静态工具类，不做编排。</p>
 */
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

    /**
     * Resolve aggregate win as Boolean（team perspective / supremacy 规则）。
     * 结算 winnerTeam 缺失时 fail closed：victoryPointsEarned 的精确定义及是否包含被动增长/击杀夺分仍未证明，禁止比较推断胜方；
     * 无法判定返回 null。
     */
    static Boolean resolveAggregateWin(final Battle battle, final int perspectiveTeam) {
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, perspectiveTeam);
        return switch (w.winner()) {
            case FRIENDLY_WIN -> Boolean.TRUE;
            case ENEMY_WIN -> Boolean.FALSE;
            case DRAW_OR_UNKNOWN -> null;
        };
    }

    /**
     * Evidence-quality + identity gate for damage (time is already gated by
     * {@link BattleStartResolution#tryRelative}): confidence must be usable and both attacker and victim must map
     * to a usable identity. In-battle damage that fails this is genuine unattributed damage.
     */
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
            final int perspectiveTeam,
            final int unattributedCount
    ) {
        final int dealt = timedDamages.stream()
                .filter(td -> td.event().attacker().team() == perspectiveTeam
                        && td.event().victim().team() != perspectiveTeam)
                .mapToInt(td -> td.event().event().damage())
                .sum();
        final int received = timedDamages.stream()
                .filter(td -> td.event().victim().team() == perspectiveTeam
                        && td.event().attacker().team() != perspectiveTeam)
                .mapToInt(td -> td.event().event().damage())
                .sum();
        final int attributed = (int) timedDamages.stream()
                .filter(td -> DefaultTeamBattleFeatureExtractor.involvesTeam(td.event(), perspectiveTeam))
                .count();
        return new TeamObservedAggregate(dealt, received, attributed, unattributedCount);
    }

}
