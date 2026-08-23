package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 团队/成员交火提取器：按伤害时间间隔切分交火段、计算成员与团队 EngagementSummary、
 * 识别集火候选（同一目标短窗口内多攻击者）。
 * <p>从 {@link DefaultTeamBattleFeatureExtractor} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamEngagementExtractor {

    private TeamEngagementExtractor() {
    }

    static final int ENGAGEMENT_GAP_SEC = 10;
    static final float FOCUS_FIRE_WINDOW_SEC = 5f;
    static final int MIN_FOCUS_FIRE_ATTACKERS = 2;

    static List<TeamEngagementSummary> buildTeamEngagements(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedDamages,
            final List<DefaultTeamBattleFeatureExtractor.AttributedHpLoss> teamLosses,
            final int perspectiveTeam
    ) {
        final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> teamDamages = sortedDamageEvents(
                timedDamages.stream()
                        .filter(td -> DefaultTeamBattleFeatureExtractor.involvesTeam(td.event(), perspectiveTeam))
                        .toList());
        if (teamDamages.isEmpty()) {
            return List.of();
        }
        final List<TeamEngagementSummary> result = new ArrayList<>();
        int segmentStart = 0;
        for (int index = 1; index < teamDamages.size(); index++) {
            if (damageGap(teamDamages.get(index - 1), teamDamages.get(index))
                    > ENGAGEMENT_GAP_SEC) {
                result.add(buildTeamEngagementSegment(
                        teamDamages.subList(segmentStart, index), teamLosses, perspectiveTeam));
                segmentStart = index;
            }
        }
        result.add(buildTeamEngagementSegment(
                teamDamages.subList(segmentStart, teamDamages.size()), teamLosses, perspectiveTeam));
        return List.copyOf(result);
    }

    static List<EngagementSummary> buildMemberEngagements(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedDamages,
            final List<DefaultTeamBattleFeatureExtractor.AttributedHpLoss> teamLosses,
            final MemberIdentity memberId
    ) {
        final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> memberDamage = timedDamages.stream()
                .filter(td -> td.event().attacker() != null
                        && td.event().attacker().team() != td.event().victim().team())
                .filter(td -> memberId.matches(td.event().attacker())
                        || memberId.matches(td.event().victim()))
                .toList();
        final int memberTeam = memberDamage.stream()
                .map(td -> memberId.matches(td.event().attacker())
                        ? td.event().attacker().team() : td.event().victim().team())
                .findFirst()
                .orElse(0);
        return memberTeam == 0
                ? List.of()
                : buildEngagements(memberDamage, teamLosses, memberTeam, memberId);
    }

    static List<EngagementSummary> buildEngagements(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedDamages,
            final List<DefaultTeamBattleFeatureExtractor.AttributedHpLoss> teamLosses,
            final int perspectiveTeam,
            final MemberIdentity memberId
    ) {
        if (timedDamages.isEmpty()) {
            return List.of();
        }
        final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> sorted = sortedDamageEvents(timedDamages);
        final List<EngagementSummary> result = new ArrayList<>();
        int segmentStart = 0;
        for (int index = 1; index < sorted.size(); index++) {
            if (damageGap(sorted.get(index - 1), sorted.get(index))
                    > ENGAGEMENT_GAP_SEC) {
                result.add(buildEngagementSegment(
                        sorted.subList(segmentStart, index), teamLosses,
                        perspectiveTeam, memberId.accountId(), memberId));
                segmentStart = index;
            }
        }
        result.add(buildEngagementSegment(
                sorted.subList(segmentStart, sorted.size()), teamLosses,
                perspectiveTeam, memberId.accountId(), memberId));
        return List.copyOf(result);
    }

    static List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> sortedDamageEvents(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedDamages
    ) {
        return timedDamages.stream()
                .sorted(Comparator
                        .comparingDouble(DefaultTeamBattleFeatureExtractor.TimedTeamDamage::battleRelativeSec)
                        .thenComparingInt(td -> td.event().event().sequence()))
                .toList();
    }

    static float damageGap(
            final DefaultTeamBattleFeatureExtractor.TimedTeamDamage previous,
            final DefaultTeamBattleFeatureExtractor.TimedTeamDamage current
    ) {
        return current.battleRelativeSec() - previous.battleRelativeSec();
    }

    static TeamEngagementSummary buildTeamEngagementSegment(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedEvents,
            final List<DefaultTeamBattleFeatureExtractor.AttributedHpLoss> teamLosses,
            final int perspectiveTeam
    ) {
        final EngagementSummary base =
                buildEngagementSegment(timedEvents, teamLosses, perspectiveTeam, null, null);
        final Map<Long, List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage>> damageByTarget = new HashMap<>();
        final List<String> orderedTargets = new ArrayList<>();
        for (final DefaultTeamBattleFeatureExtractor.TimedTeamDamage td : timedEvents) {
            final DefaultTeamBattleFeatureExtractor.AttributedDamage damage = td.event();
            if (damage.attacker().team() != perspectiveTeam
                    || damage.victim().team() == perspectiveTeam) {
                continue;
            }
            damageByTarget
                    .computeIfAbsent(
                            damage.victim().accountId(),
                            ignored -> new ArrayList<>())
                    .add(td);
            orderedTargets.add(DefaultTeamBattleFeatureExtractor.identityKey(damage.victim()));
        }
        final List<Long> focusedTargets = damageByTarget.entrySet().stream()
                .filter(entry -> entry.getKey() > 0)
                .filter(entry -> isFocusFireCandidate(entry.getValue()))
                .map(Map.Entry::getKey)
                .sorted()
                .toList();
        int targetSwitchCount = 0;
        for (int index = 1; index < orderedTargets.size(); index++) {
            if (!orderedTargets.get(index).equals(orderedTargets.get(index - 1))) {
                targetSwitchCount++;
            }
        }
        return new TeamEngagementSummary(
                base.startTime(),
                base.endTime(),
                base.alliedAccountIds(),
                base.enemyAccountIds(),
                base.damageDealt(),
                base.damageReceived(),
                focusedTargets,
                targetSwitchCount,
                base.confidence());
    }

    static boolean isFocusFireCandidate(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> targetDamage
    ) {
        final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> sorted = sortedDamageEvents(targetDamage);
        for (int start = 0; start < sorted.size(); start++) {
            final Set<String> attackers = new LinkedHashSet<>();
            final float startClock = sorted.get(start).battleRelativeSec();
            for (int end = start; end < sorted.size(); end++) {
                final DefaultTeamBattleFeatureExtractor.TimedTeamDamage td = sorted.get(end);
                final float endClock = td.battleRelativeSec();
                if (endClock - startClock > FOCUS_FIRE_WINDOW_SEC) {
                    break;
                }
                attackers.add(DefaultTeamBattleFeatureExtractor.identityKey(td.event().attacker()));
                if (attackers.size() >= MIN_FOCUS_FIRE_ATTACKERS) {
                    return true;
                }
            }
        }
        return false;
    }

    static EngagementSummary buildEngagementSegment(
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedEvents,
            final List<DefaultTeamBattleFeatureExtractor.AttributedHpLoss> teamLosses,
            final int perspectiveTeam,
            final Long memberAccountId,
            final MemberIdentity memberIdentity
    ) {
        final Set<Long> allies = new LinkedHashSet<>();
        final Set<Long> enemies = new LinkedHashSet<>();
        int dealt = 0;
        int received = 0;
        DecodeConfidence confidence = DecodeConfidence.EXACT;
        // allies/enemies/confidence 来自事件级结构（时间/方向/身份）；dealt/received 用 loss 级聚合（§13）
        for (final DefaultTeamBattleFeatureExtractor.TimedTeamDamage td : timedEvents) {
            final DefaultTeamBattleFeatureExtractor.AttributedDamage damage = td.event();
            if (damage.attacker().team() == perspectiveTeam) {
                allies.add(damage.attacker().accountId());
                enemies.add(damage.victim().accountId());
            } else if (damage.victim().team() == perspectiveTeam) {
                allies.add(damage.victim().accountId());
                enemies.add(damage.attacker().accountId());
            }
            confidence = DefaultTeamBattleFeatureExtractor.lowerConfidence(confidence, damage.event().confidence());
            confidence = DefaultTeamBattleFeatureExtractor.lowerConfidence(confidence, damage.attacker().confidence());
            confidence = DefaultTeamBattleFeatureExtractor.lowerConfidence(confidence, damage.victim().confidence());
        }
        final double from = timedEvents.getFirst().battleRelativeSec();
        final double to = timedEvents.getLast().battleRelativeSec();
        for (final DefaultTeamBattleFeatureExtractor.AttributedHpLoss l : teamLosses) {
            if (l.loss().toSec() < from - 1e-6 || l.loss().toSec() > to + 1e-6) {
                continue;
            }
            final boolean attackerIsSubject = memberIdentity == null
                    ? l.attacker() != null && l.attacker().team() == perspectiveTeam
                    : l.attacker() != null && memberIdentity.matches(l.attacker());
            final boolean victimIsSubject = memberIdentity == null
                    ? l.victim() != null && l.victim().team() == perspectiveTeam
                    : l.victim() != null && memberIdentity.matches(l.victim());
            final boolean crossTeam = l.attacker() == null
                    || l.victim() == null
                    || l.attacker().team() != l.victim().team();
            if (attackerIsSubject && l.attacker() != null && l.victim() != null
                    && l.attacker().team() != l.victim().team()) {
                dealt += l.loss().hpLoss();
            }
            if (victimIsSubject && crossTeam) {
                received += l.loss().hpLoss();
            }
        }
        return new EngagementSummary(
                (float) from,
                (float) to,
                allies.stream().sorted().toList(),
                enemies.stream().sorted().toList(),
                dealt,
                received,
                null,
                null,
                confidence);
    }

}