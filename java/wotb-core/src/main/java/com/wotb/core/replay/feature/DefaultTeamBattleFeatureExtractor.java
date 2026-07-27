package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;

import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 默认队伍特征提取器。
 * 所有位置与伤害归因都依赖 {@link TeamEntityMapper}，未知实体不会进入本队统计。
 */
public class DefaultTeamBattleFeatureExtractor implements TeamBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 10;
    static final float FORMATION_WINDOW_SEC = 15f;
    static final float FORMATION_CLUSTER_DISTANCE_METERS = 100f; // canonical meters
    static final double ENGAGEMENT_OUTCOME_RATIO = 1.25;
    static final float FOCUS_FIRE_WINDOW_SEC = 5f;
    static final int MIN_FOCUS_FIRE_ATTACKERS = 2;
    static final float MAX_ABSOLUTE_MAP_COORDINATE = MapRegionResolver.MAX_RAW_ALLOWED;
    static final float MAX_ABSOLUTE_ELEVATION = 200f;
    static final int MAX_KEY_EVENTS = 40;

    @Override
    public TeamBattleFeatureSet extract(
            final Battle battle,
            final ReplayReconstruction reconstruction,
            final TeamPerspectiveResolution perspective
    ) {
        if (perspective == null || !perspective.resolved()) {
            return TeamBattleFeatureSet.empty(0);
        }

        final int perspectiveTeam = perspective.perspectiveTeam();
        final BattleStartResolution battleStartRes = BattleStartResolver.resolve(
                reconstruction != null ? reconstruction.battleStartRawClockSec() : null,
                reconstruction != null ? reconstruction.diagnostics() : null);
        final List<ReplayEvent> events = reconstruction != null && reconstruction.events() != null
                ? reconstruction.events().stream()
                        .sorted(Comparator.comparingInt(ReplayEvent::sequence))
                        .toList()
                : List.of();
        final TeamEntityMapping entityMapping = TeamEntityMapper.resolve(battle, reconstruction);
        final List<PlayerResult> authoritativeMembers = authoritativeMembers(battle, perspectiveTeam);
        final TeamAggregateResult authoritativeAggregate = buildAuthoritativeAggregate(
                battle, authoritativeMembers, perspectiveTeam);

        final Map<Integer, List<PositionChangedEvent>> positionsByEntity =
                teamPositionsByEntity(events, entityMapping, perspectiveTeam, battleStartRes);
        final PositionEvidenceAudit positionAudit =
                auditPositionEvidence(events, entityMapping, perspectiveTeam, battleStartRes);
        final int invalidTimestampEventCount = (int) events.stream()
                .filter(event -> !hasUsableClock(event))
                .count();
        final boolean hasUsableTimedEvent = events.stream()
                .anyMatch(event -> classifyTime(event, battleStartRes) == EvidenceTime.USABLE);
        final List<AttributedDamage> attributedDamage = new ArrayList<>();
        int unattributedDamageCount = 0;
        for (final ReplayEvent event : events) {
            if (!(event instanceof DamageEvent damage) || damage.damage() <= 0) {
                continue;
            }
            // Shared time gate: INVALID_TIMESTAMP damage is reported ONLY via
            // invalidTimestampEventCount and PRE_BATTLE (preparation-phase) damage is excluded
            // from every tactical statistic. Neither is counted as unattributed tactical damage;
            // only genuinely attributable-but-unmapped in-battle damage is unattributed.
            if (classifyTime(damage, battleStartRes) != EvidenceTime.USABLE) {
                continue;
            }
            final TeamEntityIdentity attacker = entityMapping.identity(damage.attackerEid());
            final TeamEntityIdentity victim = entityMapping.identity(damage.victimEid());
            if (!usableDamageEvidence(damage, attacker, victim)) {
                unattributedDamageCount++;
                continue;
            }
            attributedDamage.add(new AttributedDamage(damage, attacker, victim));
        }

        // Pre-resolve battle-relative times via TacticalTimeResolution
        final List<TimedTeamDamage> timedDamages = new ArrayList<>();
        final Set<String> timeLimitations = new LinkedHashSet<>();
        for (final AttributedDamage damage : attributedDamage) {
            final TacticalTimeResolution res = battleStartRes.tryRelative(damage.event().timestamp());
            if (res.isUsable()) {
                timedDamages.add(new TimedTeamDamage(damage, res.battleRelativeSec()));
            } else if (res.limitation() != null) {
                timeLimitations.add(res.limitation());
            }
        }
        final Map<Integer, List<TimedTeamPosition>> timedPositionsByEntity = new LinkedHashMap<>();
        for (final Map.Entry<Integer, List<PositionChangedEvent>> entry : positionsByEntity.entrySet()) {
            final List<TimedTeamPosition> timedList = new ArrayList<>();
            for (final PositionChangedEvent pos : entry.getValue()) {
                final TacticalTimeResolution res = battleStartRes.tryRelative(pos.timestamp());
                if (res.isUsable()) {
                    timedList.add(new TimedTeamPosition(pos, res.battleRelativeSec()));
                } else if (res.limitation() != null) {
                    timeLimitations.add(res.limitation());
                }
            }
            if (!timedList.isEmpty()) {
                timedPositionsByEntity.put(entry.getKey(), timedList);
            }
        }

        final List<TeamMemberFeatureSet> members = authoritativeMembers.stream()
                .map(player -> buildMember(
                        player, entityMapping, timedPositionsByEntity, timedDamages, authoritativeMembers, battleStartRes))
                .sorted(Comparator.comparingLong(TeamMemberFeatureSet::accountId)
                        .thenComparing(TeamMemberFeatureSet::nickname,
                                Comparator.nullsLast(String::compareTo)))
                .toList();
        final List<TeamEngagementSummary> engagements = buildTeamEngagements(
                timedDamages, perspectiveTeam, battleStartRes);
        final TeamObservedAggregate observedAggregate = buildObservedAggregate(
                timedDamages, perspectiveTeam, unattributedDamageCount);
        final List<TeamFormationPhase> formationPhases = buildFormationPhases(
                timedPositionsByEntity, entityMapping, perspectiveTeam, battleStartRes);
        final float firstContactTime = timedDamages.stream()
                .filter(td -> involvesTeam(td.event(), perspectiveTeam))
                .mapToDouble(TimedTeamDamage::battleRelativeSec)
                .min()
                .stream()
                .mapToObj(value -> (float) value)
                .findFirst()
                .orElse(-1f);
        final BattleEndEvidence battleEnd = findBattleEndEvidence(events, battle, battleStartRes);
        final float phaseEndClock = battleEnd.clockSec() != null
                ? battleEnd.clockSec() : lastObservedClock(events, battleStartRes);
        final List<BattlePhaseSummary> battlePhases = hasUsableTimedEvent
                ? BattlePhaseSummary.buildRelativePhases(
                        firstContactTime, phaseEndClock)
                : List.of();
        final List<KeyBattleEvent> keyEvents = buildKeyEvents(
                battle, authoritativeMembers, entityMapping, timedDamages,
                formationPhases, perspectiveTeam, battleEnd, battleStartRes);

        final int mappedMembers = entityMapping.mappedMembers(perspectiveTeam);
        // observed = positions that actually feed movement/formation analysis
        // (teamPositionsByEntity already excluded pre-battle, invalid clock, out-of-bounds,
        // unusable identity and non-perspective entities). clamped is a strict subset of the
        // same collection, so clampedPositionEventCount <= observedPositionEventCount holds.
        final int observedPositionEventCount = (int) timedPositionsByEntity.values().stream()
                .flatMap(List::stream)
                .count();
        final int clampedPositionEventCount = (int) timedPositionsByEntity.values().stream()
                .flatMap(List::stream)
                .map(TimedTeamPosition::event)
                .filter(DefaultTeamBattleFeatureExtractor::isClamped)
                .count();
        final boolean reconstructionAvailable = reconstruction != null;
        final boolean fullFeaturesAvailable = reconstructionAvailable
                && mappedMembers > 0
                && (observedPositionEventCount > 0 || !engagements.isEmpty());
        final boolean streamComplete = reconstructionAvailable
                && reconstruction.coverage() != null
                && reconstruction.coverage().streamComplete();
        final double decodedRatio = reconstructionAvailable
                && reconstruction.coverage() != null
                ? reconstruction.coverage().decodedPacketRatio() : 0.0;
        final TeamFeatureCoverage coverage = new TeamFeatureCoverage(
                authoritativeAggregate != null,
                reconstructionAvailable,
                streamComplete,
                authoritativeMembers.size(),
                mappedMembers,
                observedPositionEventCount,
                timedDamages.size(),
                unattributedDamageCount,
                positionAudit.unattributedCount(),
                clampedPositionEventCount,
                positionAudit.outOfBoundsCount(),
                invalidTimestampEventCount,
                decodedRatio,
                fullFeaturesAvailable);

        final Set<String> limitations = new LinkedHashSet<>(perspective.limitations());
        limitations.addAll(timeLimitations);
        limitations.addAll(entityMapping.limitations());
        if (battleStartRes.limitation() != null) {
            limitations.add(battleStartRes.limitation());
        }
        limitations.add("OBSERVED_DAMAGE_IS_PARTIAL");
        if (authoritativeAggregate == null) {
            limitations.add("AUTHORITATIVE_TEAM_RESULT_UNAVAILABLE");
        }
        if (!reconstructionAvailable || observedPositionEventCount == 0) {
            limitations.add("POSITION_FORMATION_UNAVAILABLE");
        }
        if (!reconstructionAvailable || engagements.isEmpty()) {
            limitations.add("TEAM_ENGAGEMENTS_UNAVAILABLE");
        }
        if (unattributedDamageCount > 0) {
            limitations.add("UNATTRIBUTED_DAMAGE_EVENTS_PRESENT");
        }
        if (positionAudit.unattributedCount() > 0) {
            limitations.add("UNATTRIBUTED_POSITION_EVENTS_PRESENT");
        }
        if (positionAudit.outOfBoundsCount() > 0) {
            limitations.add("OUT_OF_BOUNDS_POSITION_EVENTS_IGNORED");
        }
        if (clampedPositionEventCount > 0) {
            limitations.add("MAP_COORDINATES_CLAMPED");
        }
        if (invalidTimestampEventCount > 0) {
            limitations.add("INVALID_EVENT_TIMESTAMPS_IGNORED");
        }
        if (reconstructionAvailable && reconstruction.coverage() != null && !streamComplete) {
            limitations.add("REPLAY_STREAM_PARTIAL");
        }

        final boolean hasFeatures =
                (authoritativeAggregate != null && !members.isEmpty())
                        || (mappedMembers > 0 && fullFeaturesAvailable);
        if (!hasFeatures) {
            limitations.add("TEAM_FEATURES_UNAVAILABLE");
        }
        return new TeamBattleFeatureSet(
                perspectiveTeam,
                members,
                authoritativeAggregate,
                observedAggregate,
                formationPhases,
                engagements,
                battlePhases,
                keyEvents,
                coverage,
                List.copyOf(limitations),
                hasFeatures);
    }

    private static List<PlayerResult> authoritativeMembers(
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

    private static TeamAggregateResult buildAuthoritativeAggregate(
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
                resolveAggregateWin(battle.winnerTeam, perspectiveTeam));
    }

    /**
     * Resolve aggregate win as Boolean.
     * Returns null for unknown (invalid teams), true for win, false for loss.
     * Only raw teams 1 and 2 are valid; anything else returns null.
     */
    private static Boolean resolveAggregateWin(final Integer winnerTeam, final int perspectiveTeam) {
        if (winnerTeam == null) return null;
        if (!PlayerSideResolver.isValidRawTeam(winnerTeam)
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return null;
        }
        return winnerTeam == perspectiveTeam;
    }

    private static String buildResultLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.winnerTeam == null) return "result=DRAW_OR_UNKNOWN";
        if (!PlayerSideResolver.isValidRawTeam(battle.winnerTeam)
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return "result=DRAW_OR_UNKNOWN";
        }
        if (battle.winnerTeam == perspectiveTeam) return "result=TEAM_WIN";
        return "result=TEAM_LOSS";
    }

    private static Map<Integer, List<PositionChangedEvent>> teamPositionsByEntity(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final BattleStartResolution battleStartRes
    ) {
        final Map<Integer, List<PositionChangedEvent>> result = new LinkedHashMap<>();
        events.stream()
                .filter(PositionChangedEvent.class::isInstance)
                .map(PositionChangedEvent.class::cast)
                .filter(position -> classifyTime(position, battleStartRes) == EvidenceTime.USABLE)
                .filter(DefaultTeamBattleFeatureExtractor::usableSpatialEvidence)
                .filter(position -> {
                    final TeamEntityIdentity identity = mapping.identity(position.entityId());
                    return identity != null && identity.usable()
                            && identity.team() == perspectiveTeam;
                })
                .forEach(position -> result
                        .computeIfAbsent(position.entityId(), ignored -> new ArrayList<>())
                        .add(position));
        result.values().forEach(positions ->
                positions.sort(Comparator.comparingInt(PositionChangedEvent::sequence)));
        return result;
    }

    /**
     * Diagnostic audit for position evidence that does NOT feed analysis: unattributable
     * positions and out-of-bounds positions. Observed and clamped counts are derived directly
     * from the analyzed {@code positionsByEntity} collection (single source of truth), so this
     * method deliberately does not recompute them. Uses {@code battleStartRes} to exclude
     * pre-battle preparation positions; invalid-timestamp positions are excluded here and
     * reported via {@code ignoredInvalidTimestampEventCount}.
     */
    private static PositionEvidenceAudit auditPositionEvidence(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final BattleStartResolution battleStartRes
    ) {
        int unattributedCount = 0;
        int outOfBoundsCount = 0;
        for (final ReplayEvent event : events) {
            if (!(event instanceof PositionChangedEvent position)) {
                continue;
            }
            if (classifyTime(position, battleStartRes) != EvidenceTime.USABLE) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(position.entityId());
            if (identity == null || !identity.usable()) {
                unattributedCount++;
                continue;
            }
            if (identity.team() != perspectiveTeam) {
                continue; // enemy position, not counted in perspective coverage
            }
            if (isOutOfBounds(position)) {
                outOfBoundsCount++;
            }
        }
        return new PositionEvidenceAudit(unattributedCount, outOfBoundsCount);
    }

    private static TeamMemberFeatureSet buildMember(
            final PlayerResult player,
            final TeamEntityMapping mapping,
            final Map<Integer, List<TimedTeamPosition>> timedPositionsByEntity,
            final List<TimedTeamDamage> damageEvents,
            final List<PlayerResult> authoritativeMembers,
            final BattleStartResolution battleStartRes
    ) {
        final long memberAccountId = player.accountId;
        final String memberNickname = player.nickname;
        final MemberIdentity memberId = MemberIdentity.resolve(player, authoritativeMembers);
        final List<Integer> entityIds =
                mapping.entityIds(player.accountId, player.nickname);
        final List<MovementSegment> movements = entityIds.stream()
                .map(entityId -> timedPositionsByEntity.getOrDefault(entityId, List.of()))
                .flatMap(timedPositions -> {
                    final List<PositionChangedEvent> posEvents = timedPositions.stream()
                            .map(TimedTeamPosition::event)
                            .toList();
                    return DefaultPlayerBattleFeatureExtractor
                            .compressMovements(posEvents, battleStartRes).stream();
                })
                .sorted(Comparator.comparingDouble(MovementSegment::startTime)
                        .thenComparingDouble(MovementSegment::endTime))
                .toList();
        final DecodeConfidence mappingConfidence = entityIds.stream()
                .map(mapping::identity)
                .filter(Objects::nonNull)
                .map(TeamEntityIdentity::confidence)
                .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);
        final List<EngagementSummary> engagements = buildMemberEngagements(
                damageEvents, memberId, battleStartRes);
        final List<String> limitations = new ArrayList<>();
        if (memberId.ambiguousNickname()) {
            limitations.add("TEAM_MEMBER_IDENTITY_UNRESOLVED");
        }
        if (entityIds.isEmpty()) {
            limitations.add("TEAM_MEMBER_ENTITY_UNMAPPED");
        }
        if (movements.isEmpty()) {
            limitations.add("TEAM_MEMBER_MOVEMENT_UNAVAILABLE");
        }
        final Double deathTime = player.survived || PlayerResultFormat.deathSec(player) <= 0
                ? null : PlayerResultFormat.deathSec(player);
        final List<KeyBattleEvent> keyEvents = deathTime == null
                ? List.of()
                : List.of(new KeyBattleEvent(
                        deathTime.floatValue(),
                        "TEAM_MEMBER_DESTROYED",
                        "accountId=" + player.accountId,
                        DecodeConfidence.EXACT,
                        "BATTLE_RESULTS",
                        entityIds));
        return new TeamMemberFeatureSet(
                entityIds,
                player.accountId,
                player.nickname,
                player.tankId,
                player.tankName,
                player.team,
                entityIds.isEmpty() ? DecodeConfidence.UNKNOWN : mappingConfidence,
                player.damageDealt,
                player.damageReceived,
                player.damageAssisted,
                player.damageBlocked,
                player.kills,
                player.survived,
                deathTime,
                movements,
                engagements,
                keyEvents,
                limitations);
    }

    /**
     * Evidence-quality + identity gate for damage (time is already gated by
     * {@link #classifyTime}): confidence must be usable and both attacker and victim must map
     * to a usable identity. In-battle damage that fails this is genuine unattributed damage.
     */
    private static boolean usableDamageEvidence(
            final DamageEvent damage,
            final TeamEntityIdentity attacker,
            final TeamEntityIdentity victim
    ) {
        return damage.confidence() != DecodeConfidence.UNKNOWN
                && damage.confidence() != DecodeConfidence.PARTIAL
                && attacker != null && attacker.usable()
                && victim != null && victim.usable();
    }

    private static TeamObservedAggregate buildObservedAggregate(
            final List<TimedTeamDamage> timedDamages,
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
                .filter(td -> involvesTeam(td.event(), perspectiveTeam))
                .count();
        return new TeamObservedAggregate(dealt, received, attributed, unattributedCount);
    }

    private static List<TeamEngagementSummary> buildTeamEngagements(
            final List<TimedTeamDamage> timedDamages,
            final int perspectiveTeam,
            final BattleStartResolution battleStartRes
    ) {
        final List<TimedTeamDamage> teamDamages = sortedDamageEvents(
                timedDamages.stream()
                        .filter(td -> involvesTeam(td.event(), perspectiveTeam))
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
                        teamDamages.subList(segmentStart, index), perspectiveTeam, battleStartRes));
                segmentStart = index;
            }
        }
        result.add(buildTeamEngagementSegment(
                teamDamages.subList(segmentStart, teamDamages.size()), perspectiveTeam, battleStartRes));
        return List.copyOf(result);
    }

    private static List<EngagementSummary> buildMemberEngagements(
            final List<TimedTeamDamage> timedDamages,
            final MemberIdentity memberId,
            final BattleStartResolution battleStartRes
    ) {
        final List<TimedTeamDamage> memberDamage = timedDamages.stream()
                .filter(td -> td.event().attacker().team() != td.event().victim().team())
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
                   : buildEngagements(memberDamage, memberTeam, memberId, battleStartRes);
    }

    private static List<EngagementSummary> buildEngagements(
            final List<TimedTeamDamage> timedDamages,
            final int perspectiveTeam,
            final MemberIdentity memberId,
            final BattleStartResolution battleStartRes
    ) {
        if (timedDamages.isEmpty()) {
            return List.of();
        }
        final List<TimedTeamDamage> sorted = sortedDamageEvents(timedDamages);
        final List<EngagementSummary> result = new ArrayList<>();
        int segmentStart = 0;
        for (int index = 1; index < sorted.size(); index++) {
            if (damageGap(sorted.get(index - 1), sorted.get(index))
                    > ENGAGEMENT_GAP_SEC) {
                result.add(buildEngagementSegment(
                        sorted.subList(segmentStart, index), perspectiveTeam, memberId.accountId(), memberId));
                segmentStart = index;
            }
        }
        result.add(buildEngagementSegment(
                sorted.subList(segmentStart, sorted.size()), perspectiveTeam, memberId.accountId(), memberId));
        return List.copyOf(result);
    }
    private static List<TimedTeamDamage> sortedDamageEvents(
            final List<TimedTeamDamage> timedDamages
    ) {
        return timedDamages.stream()
                .sorted(Comparator
                        .comparingDouble(TimedTeamDamage::battleRelativeSec)
                        .thenComparingInt(td -> td.event().event().sequence()))
                .toList();
    }

    private static float damageGap(
            final TimedTeamDamage previous,
            final TimedTeamDamage current
    ) {
        return current.battleRelativeSec() - previous.battleRelativeSec();
    }

    private static TeamEngagementSummary buildTeamEngagementSegment(
            final List<TimedTeamDamage> timedEvents,
            final int perspectiveTeam,
            final BattleStartResolution battleStartRes
    ) {
        final EngagementSummary base =
                buildEngagementSegment(timedEvents, perspectiveTeam, null, null);
        final Map<Long, List<TimedTeamDamage>> damageByTarget = new HashMap<>();
        final List<String> orderedTargets = new ArrayList<>();
        for (final TimedTeamDamage td : timedEvents) {
            final AttributedDamage damage = td.event();
            if (damage.attacker().team() != perspectiveTeam
                    || damage.victim().team() == perspectiveTeam) {
                continue;
            }
            damageByTarget
                    .computeIfAbsent(
                            damage.victim().accountId(),
                            ignored -> new ArrayList<>())
                    .add(td);
            orderedTargets.add(identityKey(damage.victim()));
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
                base.outcome(),
                base.confidence());
    }

    private static boolean isFocusFireCandidate(
            final List<TimedTeamDamage> targetDamage
    ) {
        final List<TimedTeamDamage> sorted = sortedDamageEvents(targetDamage);
        for (int start = 0; start < sorted.size(); start++) {
            final Set<String> attackers = new LinkedHashSet<>();
            final float startClock = sorted.get(start).battleRelativeSec();
            for (int end = start; end < sorted.size(); end++) {
                final TimedTeamDamage td = sorted.get(end);
                final float endClock = td.battleRelativeSec();
                if (endClock - startClock > FOCUS_FIRE_WINDOW_SEC) {
                    break;
                }
                attackers.add(identityKey(td.event().attacker()));
                if (attackers.size() >= MIN_FOCUS_FIRE_ATTACKERS) {
                    return true;
                }
            }
        }
        return false;
    }

    private static EngagementSummary buildEngagementSegment(
            final List<TimedTeamDamage> timedEvents,
            final int perspectiveTeam,
            final Long memberAccountId,
            final MemberIdentity memberIdentity
    ) {
        final Set<Long> allies = new LinkedHashSet<>();
        final Set<Long> enemies = new LinkedHashSet<>();
        int dealt = 0;
        int received = 0;
        DecodeConfidence confidence = DecodeConfidence.EXACT;
        for (final TimedTeamDamage td : timedEvents) {
            final AttributedDamage damage = td.event();
            final boolean attackerIsSubject = memberIdentity == null
                    ? damage.attacker().team() == perspectiveTeam
                    : memberIdentity.matches(damage.attacker());
            final boolean victimIsSubject = memberIdentity == null
                    ? damage.victim().team() == perspectiveTeam
                    : memberIdentity.matches(damage.victim());
            if (attackerIsSubject && damage.attacker().team() != damage.victim().team()) {
                dealt += damage.event().damage();
            }
            if (victimIsSubject && damage.attacker().team() != damage.victim().team()) {
                received += damage.event().damage();
            }
            if (damage.attacker().team() == perspectiveTeam) {
                allies.add(damage.attacker().accountId());
                enemies.add(damage.victim().accountId());
            } else if (damage.victim().team() == perspectiveTeam) {
                allies.add(damage.victim().accountId());
                enemies.add(damage.attacker().accountId());
            }
            confidence = lowerConfidence(confidence, damage.event().confidence());
            confidence = lowerConfidence(confidence, damage.attacker().confidence());
            confidence = lowerConfidence(confidence, damage.victim().confidence());
        }
        final EngagementOutcome outcome = dealt > received * ENGAGEMENT_OUTCOME_RATIO
                ? EngagementOutcome.FAVORABLE
                : received > dealt * ENGAGEMENT_OUTCOME_RATIO
                ? EngagementOutcome.UNFAVORABLE
                : EngagementOutcome.EVEN;
        return new EngagementSummary(
                timedEvents.getFirst().battleRelativeSec(),
                timedEvents.getLast().battleRelativeSec(),
                allies.stream().sorted().toList(),
                enemies.stream().sorted().toList(),
                dealt,
                received,
                null,
                null,
                outcome,
                confidence);
    }

    private static List<TeamFormationPhase> buildFormationPhases(
            final Map<Integer, List<TimedTeamPosition>> timedPositionsByEntity,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final BattleStartResolution battleStartRes
    ) {
        final Map<Integer, Map<String, PositionChangedEvent>> windows = new HashMap<>();
        timedPositionsByEntity.forEach((entityId, timedPositions) -> {
            final TeamEntityIdentity identity = mapping.identity(entityId);
            if (identity == null || identity.team() != perspectiveTeam) {
                return;
            }
            for (final TimedTeamPosition timedPos : timedPositions) {
                    final float activeClock = timedPos.battleRelativeSec();
                    final int window = (int) Math.floor(activeClock / FORMATION_WINDOW_SEC);
                    windows.computeIfAbsent(window, ignored -> new HashMap<>())
                            .merge(identityKey(identity), timedPos.event(),
                                    (left, right) -> left.sequence() > right.sequence() ? left : right);
            }
        });
        return windows.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> formationPhase(entry.getKey(), entry.getValue()))
                .filter(phase -> phase != null)
                .toList();
    }

    private static TeamFormationPhase formationPhase(
            final int window,
            final Map<String, PositionChangedEvent> positionsByMember
    ) {
        final List<Map.Entry<String, PositionChangedEvent>> sorted = positionsByMember.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .toList();
        final List<CanonicalMapPosition> canonicalPositions = sorted.stream()
                .map(Map.Entry::getValue)
                .map(pos -> MapRegionResolver.resolve(pos.x(), pos.z()))
                .filter(MapCoordinateResolution::usable)
                .map(MapCoordinateResolution::position)
                .toList();
        if (canonicalPositions.isEmpty()) {
            return null;
        }
        final float centroidX = (float) canonicalPositions.stream()
                .mapToDouble(CanonicalMapPosition::x)
                .average()
                .orElse(0.0);
        final float centroidZ = (float) canonicalPositions.stream()
                .mapToDouble(CanonicalMapPosition::z)
                .average()
                .orElse(0.0);
        final float dispersion = (float) canonicalPositions.stream()
                .mapToDouble(pos -> distance(
                        pos.x(), pos.z(), centroidX, centroidZ))
                .average()
                .orElse(0.0);
        final DecodeConfidence confidence = sorted.stream()
                .map(Map.Entry::getValue)
                .map(PositionChangedEvent::confidence)
                .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);

        // Build structured clusters
        final float windowStart = window * FORMATION_WINDOW_SEC;
        final float windowEnd = (window + 1) * FORMATION_WINDOW_SEC;
        final List<TeamFormationCluster> clusters = buildClusters(sorted, windowStart, windowEnd);

        return new TeamFormationPhase(
                window * FORMATION_WINDOW_SEC,
                (window + 1) * FORMATION_WINDOW_SEC,
                new CanonicalMapPosition(centroidX, centroidZ),
                dispersion,
                canonicalPositions.size(),
                confidence,
                clusters);
    }

    /**
     * Build structured clusters from sorted (identityKey, position) entries using BFS.
     */
    private static List<TeamFormationCluster> buildClusters(
            final List<Map.Entry<String, PositionChangedEvent>> sorted,
            final float startTime,
            final float endTime
    ) {
        if (sorted.isEmpty()) return List.of();
        final boolean[] visited = new boolean[sorted.size()];
        final List<TeamFormationCluster> result = new ArrayList<>();

        for (int start = 0; start < sorted.size(); start++) {
            if (visited[start]) continue;
            final List<Integer> clusterIndices = new ArrayList<>();
            final List<Integer> queue = new ArrayList<>();
            queue.add(start);
            visited[start] = true;
            while (!queue.isEmpty()) {
                final int current = queue.removeFirst();
                clusterIndices.add(current);
                final PositionChangedEvent currentPos = sorted.get(current).getValue();
                for (int candidate = 0; candidate < sorted.size(); candidate++) {
                    if (!visited[candidate] && canonicalDistance(
                            currentPos.x(), currentPos.z(),
                            sorted.get(candidate).getValue().x(),
                            sorted.get(candidate).getValue().z())
                            <= FORMATION_CLUSTER_DISTANCE_METERS) {
                        visited[candidate] = true;
                        queue.add(candidate);
                    }
                }
            }

            // Resolve/clamp EACH member position to canonical FIRST, then average in canonical
            // space. Averaging raw coordinates before conversion would misplace clusters whose
            // members are out-of-range-but-valid (clamped) — e.g. raw X {1050, 649.9} must map
            // to canonical {500, 412.475} → centroid 456.2375, not resolve(mean(raw)).
            final List<MapCoordinateResolution> memberResolutions = clusterIndices.stream()
                    .map(i -> sorted.get(i).getValue())
                    .map(pos -> MapRegionResolver.resolve(pos.x(), pos.z()))
                    .filter(MapCoordinateResolution::usable)
                    .toList();
            if (memberResolutions.isEmpty()) continue;
            final float centroidX = (float) memberResolutions.stream()
                    .mapToDouble(res -> res.position().x())
                    .average().orElse(0.0);
            final float centroidZ = (float) memberResolutions.stream()
                    .mapToDouble(res -> res.position().z())
                    .average().orElse(0.0);
            final CanonicalMapPosition canon = new CanonicalMapPosition(centroidX, centroidZ);
            final int region = canon.region();
            final int clampedPosCount = (int) memberResolutions.stream()
                    .filter(res -> res.status() == MapCoordinateResolution.Status.CLAMPED)
                    .count();
            // The centroid inherits CLAMPED whenever it is derived from any clamped member.
            final MapCoordinateResolution.Status centroidStatus = clampedPosCount > 0
                    ? MapCoordinateResolution.Status.CLAMPED
                    : MapCoordinateResolution.Status.VALID;
            final List<String> identities = clusterIndices.stream()
                    .map(i -> sorted.get(i).getKey())
                    .sorted()
                    .toList();
            final DecodeConfidence clusterConfidence = clusterIndices.stream()
                    .map(i -> sorted.get(i).getValue().confidence())
                    .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);

            result.add(new TeamFormationCluster(
                    startTime, endTime, canon, centroidStatus, region, clampedPosCount, identities, clusterConfidence));
        }

        // Sort by startTime, region, centroidX, centroidZ, then member identities
        result.sort(Comparator.comparingInt(TeamFormationCluster::region)
                .thenComparingDouble(TeamFormationCluster::centroidX)
                .thenComparingDouble(TeamFormationCluster::centroidZ));
        return List.copyOf(result);
    }

    private static float distance(
            final float leftX,
            final float leftZ,
            final float rightX,
            final float rightZ
    ) {
        final float deltaX = leftX - rightX;
        final float deltaZ = leftZ - rightZ;
        return (float) Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    }

    /**
     * Canonical distance in meters for cluster connectivity. Delegates to the single shared
     * {@link MapRegionResolver#canonicalDistanceMeters} helper; unresolvable endpoints map to
     * {@link Float#MAX_VALUE} so they can never join a cluster.
     */
    private static float canonicalDistance(
            final float rawX1, final float rawZ1,
            final float rawX2, final float rawZ2
    ) {
        final float meters = MapRegionResolver.canonicalDistanceMeters(rawX1, rawZ1, rawX2, rawZ2);
        return meters < 0f ? Float.MAX_VALUE : meters;
    }

    /**
     * Evidence-quality + spatial gate for positions (time is already gated by
     * {@link #classifyTime}): confidence must be usable and the coordinate must be within
     * bounds / clampable.
     */
    private static boolean usableSpatialEvidence(
            final PositionChangedEvent position
    ) {
        return position.confidence() != DecodeConfidence.UNKNOWN
                && !isOutOfBounds(position);
    }

    private static boolean isClamped(final PositionChangedEvent position) {
        return MapRegionResolver.resolve(position.x(), position.z()).status()
                == MapCoordinateResolution.Status.CLAMPED;
    }

    private static boolean isOutOfBounds(
            final PositionChangedEvent position
    ) {
        if (Math.abs(position.y()) > MAX_ABSOLUTE_ELEVATION) return true;
        return !MapRegionResolver.resolve(position.x(), position.z()).usable();
    }

    private static boolean hasUsableClock(final ReplayEvent event) {
        if (event == null || event.timestamp() == null) {
            return false;
        }
        final float clock = event.timestamp().rawClockSec();
        return Float.isFinite(clock) && clock >= 0f;
    }

    /** Temporal usability of an event's timestamp, shared by every tactical evidence path. */
    private enum EvidenceTime { USABLE, INVALID_TIMESTAMP, PRE_BATTLE }

    /**
     * Single shared time classifier used by the damage loop, {@link #teamPositionsByEntity},
     * {@link #auditPositionEvidence} and the phase guard — so no path maintains its own
     * drifting time rule. {@code INVALID_TIMESTAMP} (NaN/Infinity/negative) is reported only
     * via invalid-timestamp coverage; {@code PRE_BATTLE} is excluded from all tactical stats;
     * only {@code USABLE} evidence participates in analysis.
     */
    private static EvidenceTime classifyTime(
            final ReplayEvent event,
            final BattleStartResolution battleStartRes
    ) {
        if (!hasUsableClock(event)) {
            return EvidenceTime.INVALID_TIMESTAMP;
        }
        if (battleStartRes.isPreBattle(event.timestamp().rawClockSec())) {
            return EvidenceTime.PRE_BATTLE;
        }
        return EvidenceTime.USABLE;
    }

    private static String identityKey(final TeamEntityIdentity identity) {
        return identity.accountId() > 0
                ? "account:" + identity.accountId()
                : "nickname:" + identity.nickname();
    }

    private static List<KeyBattleEvent> buildKeyEvents(
            final Battle battle,
            final List<PlayerResult> members,
            final TeamEntityMapping mapping,
            final List<TimedTeamDamage> timedDamages,
            final List<TeamFormationPhase> formationPhases,
            final int perspectiveTeam,
            final BattleEndEvidence battleEnd,
            final BattleStartResolution battleStartRes
    ) {
        final List<KeyBattleEvent> events = new ArrayList<>();
        members.stream()
                .filter(member -> !member.survived)
                .filter(member -> PlayerResultFormat.deathSec(member) > 0)
                .sorted(Comparator.comparingDouble(PlayerResultFormat::deathSec))
                .forEach(member -> events.add(new KeyBattleEvent(
                        (float) PlayerResultFormat.deathSec(member),
                        "TEAM_MEMBER_DESTROYED",
                        "accountId=" + member.accountId + ";nickname=" + member.nickname,
                        DecodeConfidence.EXACT,
                        "BATTLE_RESULTS",
                        mapping.entityIds(member.accountId, member.nickname))));
        timedDamages.stream()
                .filter(td -> involvesTeam(td.event(), perspectiveTeam))
                .min(Comparator
                        .comparingDouble(TimedTeamDamage::battleRelativeSec)
                        .thenComparingInt(td -> td.event().event().sequence()))
                .ifPresent(td -> events.add(new KeyBattleEvent(
                        td.battleRelativeSec(),
                        "TEAM_FIRST_CONTACT",
                        "damage=" + td.event().event().damage(),
                        lowestConfidence(td.event()),
                        "REPLAY_EVENT",
                        List.of(td.event().event().attackerEid(), td.event().event().victimEid()))));
        formationPhases.stream()
                .filter(phase -> phase.observedMemberCount() > 1 && phase.clusterCount() > 1)
                .findFirst()
                .ifPresent(phase -> events.add(new KeyBattleEvent(
                        phase.startTime(),
                        "TEAM_FORMATION_SPLIT",
                        "clusters=" + phase.clusterCount()
                                + ";dispersion=" + String.format(java.util.Locale.ROOT, "%.1f",
                                phase.averageDispersion()),
                        phase.confidence(),
                        "DERIVED_POSITION",
                        List.of())));
        if (battleEnd.clockSec() != null) {
            final String resultLabel = buildResultLabel(battle, perspectiveTeam);
            events.add(new KeyBattleEvent(
                    battleEnd.clockSec(),
                    "BATTLE_END",
                    resultLabel,
                    battleEnd.confidence(),
                    battleEnd.source(),
                    List.of()));
        }
        return events.stream()
                .sorted(Comparator.comparingDouble(KeyBattleEvent::clockSec)
                        .thenComparing(KeyBattleEvent::type))
                .limit(MAX_KEY_EVENTS)
                .toList();
    }

    /**
     * Resolve battle-end evidence as a battle-relative clock.
     * <p>
     * {@code battle.durationS} is already a battle-relative duration and is used directly
     * (never re-subtracting battle start). A replay {@link BattleEndedEvent} carries a raw
     * replay clock and is converted to battle-relative via {@code battleStartRes}. Conversions
     * that are non-finite or negative are rejected (evidence falls back to unknown), so raw
     * replay absolute clocks never leak into phases or key events.
     */
    private static BattleEndEvidence findBattleEndEvidence(
            final List<ReplayEvent> events,
            final Battle battle,
            final BattleStartResolution battleStartRes
    ) {
        if (battle != null && battle.durationS != null
                && Double.isFinite(battle.durationS)
                && battle.durationS >= 0.0) {
            return new BattleEndEvidence(
                    battle.durationS.floatValue(),
                    DecodeConfidence.EXACT,
                    "BATTLE_RESULTS");
        }
        return events.stream()
                .filter(BattleEndedEvent.class::isInstance)
                .map(BattleEndedEvent.class::cast)
                .filter(DefaultTeamBattleFeatureExtractor::hasUsableClock)
                .map(event -> new BattleEndEvidence(
                        battleStartRes.battleRelative(event.timestamp().rawClockSec()),
                        event.confidence() == null
                                ? DecodeConfidence.UNKNOWN : event.confidence(),
                        "REPLAY_EVENT"))
                .filter(evidence -> Float.isFinite(evidence.clockSec())
                        && evidence.clockSec() >= 0f)
                .findFirst()
                .orElse(BattleEndEvidence.unknown());
    }

    /**
     * Battle-relative fallback clock: the latest observed raw event clock converted through
     * {@code battleStartRes}. Never mixes raw replay clock with battle-relative duration.
     */
    private static float lastObservedClock(
            final List<ReplayEvent> events,
            final BattleStartResolution battleStartRes
    ) {
        final float lastRawClock = (float) events.stream()
                .map(ReplayEvent::timestamp)
                .filter(Objects::nonNull)
                .mapToDouble(ts -> (double) ts.rawClockSec())
                .filter(Double::isFinite)
                .filter(clock -> clock >= 0.0)
                .max()
                .orElse(0.0);
        return battleStartRes.battleRelative(lastRawClock);
    }

    private static boolean involvesTeam(
            final AttributedDamage damage,
            final int perspectiveTeam
    ) {
        return damage.attacker().team() == perspectiveTeam
                && damage.victim().team() != perspectiveTeam
                || damage.victim().team() == perspectiveTeam
                && damage.attacker().team() != perspectiveTeam;
    }

    private static DecodeConfidence lowerConfidence(
            final DecodeConfidence left,
            final DecodeConfidence right
    ) {
        return confidenceRank(left) <= confidenceRank(right) ? left : right;
    }

    private static DecodeConfidence lowestConfidence(final AttributedDamage damage) {
        return lowerConfidence(
                damage.event().confidence(),
                lowerConfidence(
                        damage.attacker().confidence(),
                        damage.victim().confidence()));
    }

    private static int confidenceRank(final DecodeConfidence confidence) {
        return switch (confidence) {
            case UNKNOWN -> 0;
            case PARTIAL -> 1;
            case INFERRED -> 2;
            case EXACT -> 3;
        };
    }

    private record AttributedDamage(
            DamageEvent event,
            TeamEntityIdentity attacker,
            TeamEntityIdentity victim
    ) {
    }

    private record PositionEvidenceAudit(
            int unattributedCount,
            int outOfBoundsCount
    ) {
    }

    private record BattleEndEvidence(
            Float clockSec,
            DecodeConfidence confidence,
            String source
    ) {

        private static BattleEndEvidence unknown() {
            return new BattleEndEvidence(null, DecodeConfidence.UNKNOWN, "UNKNOWN");
        }
    }

    private record TimedTeamDamage(AttributedDamage event, float battleRelativeSec) {}

    private record TimedTeamPosition(PositionChangedEvent event, float battleRelativeSec) {}
}
