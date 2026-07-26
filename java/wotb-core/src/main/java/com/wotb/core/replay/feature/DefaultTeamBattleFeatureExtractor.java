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
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattleStartResolution;
import com.wotb.core.replay.feature.BattleStartResolver;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.util.PlayerResultFormat;

import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 默认队伍特征提取器。
 * 所有位置与伤害归因都依赖 {@link TeamEntityMapper}，未知实体不会进入本队统计。
 */
public class DefaultTeamBattleFeatureExtractor implements TeamBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 10;
    static final float FORMATION_WINDOW_SEC = 15f;
    static final float FORMATION_CLUSTER_DISTANCE = 100f;
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
                teamPositionsByEntity(events, entityMapping, perspectiveTeam);
        final PositionEvidenceAudit positionAudit =
                auditPositionEvidence(events, entityMapping);
        final int invalidTimestampEventCount = (int) events.stream()
                .filter(event -> !hasUsableClock(event))
                .count();
        final List<ReplayEvent> timedEvents = events.stream()
                .filter(DefaultTeamBattleFeatureExtractor::hasUsableClock)
                .toList();
        final List<AttributedDamage> attributedDamage = new ArrayList<>();
        int unattributedDamageCount = 0;
        for (final ReplayEvent event : events) {
            if (!(event instanceof DamageEvent damage) || damage.damage() <= 0) {
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

        final List<TeamMemberFeatureSet> members = authoritativeMembers.stream()
                .map(player -> buildMember(
                        player, entityMapping, positionsByEntity, attributedDamage, authoritativeMembers, battleStartRes))
                .sorted(Comparator.comparingLong(TeamMemberFeatureSet::accountId)
                        .thenComparing(TeamMemberFeatureSet::nickname,
                                Comparator.nullsLast(String::compareTo)))
                .toList();
        final List<TeamEngagementSummary> engagements = buildTeamEngagements(
                attributedDamage, perspectiveTeam);
        final TeamObservedAggregate observedAggregate = buildObservedAggregate(
                attributedDamage, perspectiveTeam, unattributedDamageCount);
        final List<TeamFormationPhase> formationPhases = buildFormationPhases(
                positionsByEntity, entityMapping, perspectiveTeam, battleStartRes);
        final float firstContactTime = attributedDamage.stream()
                .filter(damage -> involvesTeam(damage, perspectiveTeam))
                .mapToDouble(damage -> {
                    final float raw = ReplayTimestamp.safeClockSec(damage.event().timestamp());
                    return battleStartRes != null ? battleStartRes.battleRelative(raw) : raw;
                })
                .min()
                .stream()
                .mapToObj(value -> (float) value)
                .findFirst()
                .orElse(-1f);
        final BattleEndEvidence battleEnd = findBattleEndEvidence(events, battle);
        final float phaseEndClock = battleEnd.clockSec() != null
                ? battleEnd.clockSec() : lastObservedClock(events);
        final List<BattlePhaseSummary> battlePhases = timedEvents.isEmpty()
                ? List.of()
                : DefaultBattleFeatureExtractor.dividePhases(
                        timedEvents, phaseEndClock, firstContactTime);
        final List<KeyBattleEvent> keyEvents = buildKeyEvents(
                battle, authoritativeMembers, entityMapping, attributedDamage,
                formationPhases, perspectiveTeam, battleEnd, battleStartRes);

        final int mappedMembers = entityMapping.mappedMembers(perspectiveTeam);
        final int positionEventCount = positionsByEntity.values().stream()
                .mapToInt(List::size)
                .sum();
        final boolean reconstructionAvailable = reconstruction != null;
        final boolean fullFeaturesAvailable = reconstructionAvailable
                && mappedMembers > 0
                && (positionEventCount > 0 || !engagements.isEmpty());
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
                positionEventCount,
                attributedDamage.size(),
                unattributedDamageCount,
                positionAudit.unattributedCount(),
                positionAudit.clampedCount(),
                positionAudit.outOfBoundsCount(),
                invalidTimestampEventCount,
                decodedRatio,
                fullFeaturesAvailable);

        final Set<String> limitations = new LinkedHashSet<>(perspective.limitations());
        limitations.addAll(entityMapping.limitations());
        limitations.add("OBSERVED_DAMAGE_IS_PARTIAL");
        if (authoritativeAggregate == null) {
            limitations.add("AUTHORITATIVE_TEAM_RESULT_UNAVAILABLE");
        }
        if (!reconstructionAvailable || positionEventCount == 0) {
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
        if (positionAudit.clampedCount() > 0) {
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

    private static Map<Integer, List<PositionChangedEvent>> teamPositionsByEntity(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final int perspectiveTeam
    ) {
        final Map<Integer, List<PositionChangedEvent>> result = new LinkedHashMap<>();
        events.stream()
                .filter(PositionChangedEvent.class::isInstance)
                .map(PositionChangedEvent.class::cast)
                .filter(DefaultTeamBattleFeatureExtractor::usablePositionEvidence)
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

    private static PositionEvidenceAudit auditPositionEvidence(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        int unattributedCount = 0;
        int clampedCount = 0;
        int outOfBoundsCount = 0;
        for (final ReplayEvent event : events) {
            if (!(event instanceof PositionChangedEvent position)) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(position.entityId());
            if (identity == null || !identity.usable()) {
                unattributedCount++;
            }
            if (isOutOfBounds(position)) {
                outOfBoundsCount++;
            } else if (isClamped(position)) {
                clampedCount++;
            }
        }
        return new PositionEvidenceAudit(unattributedCount, clampedCount, outOfBoundsCount);
    }

    private static TeamMemberFeatureSet buildMember(
            final PlayerResult player,
            final TeamEntityMapping mapping,
            final Map<Integer, List<PositionChangedEvent>> positionsByEntity,
            final List<AttributedDamage> damageEvents,
            final List<PlayerResult> authoritativeMembers,
            final BattleStartResolution battleStartRes
    ) {
        final long memberAccountId = player.accountId;
        final String memberNickname = player.nickname;
        final MemberIdentity memberId = MemberIdentity.resolve(player, authoritativeMembers);
        final List<Integer> entityIds =
                mapping.entityIds(player.accountId, player.nickname);
        final List<MovementSegment> movements = entityIds.stream()
                .map(entityId -> positionsByEntity.getOrDefault(entityId, List.of()))
                .flatMap(positions -> DefaultPlayerBattleFeatureExtractor
                        .compressMovements(positions, battleStartRes).stream())
                .sorted(Comparator.comparingDouble(MovementSegment::startTime)
                        .thenComparingDouble(MovementSegment::endTime))
                .toList();
        final DecodeConfidence mappingConfidence = entityIds.stream()
                .map(mapping::identity)
                .filter(identity -> identity != null)
                .map(TeamEntityIdentity::confidence)
                .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);
        final List<EngagementSummary> engagements = buildMemberEngagements(
                damageEvents, memberId);
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

    private static boolean usableDamageEvidence(
            final DamageEvent damage,
            final TeamEntityIdentity attacker,
            final TeamEntityIdentity victim
    ) {
        return damage.confidence() != DecodeConfidence.UNKNOWN
                && damage.confidence() != DecodeConfidence.PARTIAL
                && hasUsableClock(damage)
                && attacker != null && attacker.usable()
                && victim != null && victim.usable();
    }

    private static TeamObservedAggregate buildObservedAggregate(
            final List<AttributedDamage> damages,
            final int perspectiveTeam,
            final int unattributedCount
    ) {
        final int dealt = damages.stream()
                .filter(damage -> damage.attacker().team() == perspectiveTeam
                        && damage.victim().team() != perspectiveTeam)
                .mapToInt(damage -> damage.event().damage())
                .sum();
        final int received = damages.stream()
                .filter(damage -> damage.victim().team() == perspectiveTeam
                        && damage.attacker().team() != perspectiveTeam)
                .mapToInt(damage -> damage.event().damage())
                .sum();
        final int attributed = (int) damages.stream()
                .filter(damage -> involvesTeam(damage, perspectiveTeam))
                .count();
        return new TeamObservedAggregate(dealt, received, attributed, unattributedCount);
    }

    private static List<TeamEngagementSummary> buildTeamEngagements(
            final List<AttributedDamage> damages,
            final int perspectiveTeam
    ) {
        final List<AttributedDamage> teamDamages = sortedDamageEvents(
                damages.stream()
                        .filter(damage -> involvesTeam(damage, perspectiveTeam))
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
                        teamDamages.subList(segmentStart, index), perspectiveTeam));
                segmentStart = index;
            }
        }
        result.add(buildTeamEngagementSegment(
                teamDamages.subList(segmentStart, teamDamages.size()), perspectiveTeam));
        return List.copyOf(result);
    }

    private static List<EngagementSummary> buildMemberEngagements(
            final List<AttributedDamage> damages,
            final MemberIdentity memberId
    ) {
        final List<AttributedDamage> memberDamage = damages.stream()
                .filter(damage -> damage.attacker().team() != damage.victim().team())
                .filter(damage -> memberId.matches(damage.attacker())
                        || memberId.matches(damage.victim()))
                .toList();
        final int memberTeam = memberDamage.stream()
                .map(damage -> memberId.matches(damage.attacker())
                        ? damage.attacker().team() : damage.victim().team())
                .findFirst()
                .orElse(0);
        return memberTeam == 0
                ? List.of()
                  : buildEngagements(memberDamage, memberTeam, memberId);
    }

    private static List<EngagementSummary> buildEngagements(
            final List<AttributedDamage> damages,
            final int perspectiveTeam,
            final MemberIdentity memberId
    ) {
        if (damages.isEmpty()) {
            return List.of();
        }
        final List<AttributedDamage> sorted = sortedDamageEvents(damages);
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
    private static List<AttributedDamage> sortedDamageEvents(
            final List<AttributedDamage> damages
    ) {
        return damages.stream()
                .sorted(Comparator
                        .comparingDouble((AttributedDamage damage) ->
                                ReplayTimestamp.safeClockSec(damage.event().timestamp()))
                        .thenComparingInt(damage -> damage.event().sequence()))
                .toList();
    }

    private static float damageGap(
            final AttributedDamage previous,
            final AttributedDamage current
    ) {
        return ReplayTimestamp.safeClockSec(current.event().timestamp())
                - ReplayTimestamp.safeClockSec(previous.event().timestamp());
    }

    private static TeamEngagementSummary buildTeamEngagementSegment(
            final List<AttributedDamage> events,
            final int perspectiveTeam
    ) {
        final EngagementSummary base =
                buildEngagementSegment(events, perspectiveTeam, null, null);
        final Map<Long, List<AttributedDamage>> damageByTarget = new HashMap<>();
        final List<String> orderedTargets = new ArrayList<>();
        for (final AttributedDamage damage : events) {
            if (damage.attacker().team() != perspectiveTeam
                    || damage.victim().team() == perspectiveTeam) {
                continue;
            }
            damageByTarget
                    .computeIfAbsent(
                            damage.victim().accountId(),
                            ignored -> new ArrayList<>())
                    .add(damage);
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
            final List<AttributedDamage> targetDamage
    ) {
        final List<AttributedDamage> sorted = sortedDamageEvents(targetDamage);
        for (int start = 0; start < sorted.size(); start++) {
            final Set<String> attackers = new LinkedHashSet<>();
            final float startClock =
                    ReplayTimestamp.safeClockSec(sorted.get(start).event().timestamp());
            for (int end = start; end < sorted.size(); end++) {
                final AttributedDamage damage = sorted.get(end);
                final float endClock =
                        ReplayTimestamp.safeClockSec(damage.event().timestamp());
                if (endClock - startClock > FOCUS_FIRE_WINDOW_SEC) {
                    break;
                }
                attackers.add(identityKey(damage.attacker()));
                if (attackers.size() >= MIN_FOCUS_FIRE_ATTACKERS) {
                    return true;
                }
            }
        }
        return false;
    }

    private static EngagementSummary buildEngagementSegment(
            final List<AttributedDamage> events,
            final int perspectiveTeam,
            final Long memberAccountId,
            final MemberIdentity memberIdentity
    ) {
        final Set<Long> allies = new LinkedHashSet<>();
        final Set<Long> enemies = new LinkedHashSet<>();
        int dealt = 0;
        int received = 0;
        DecodeConfidence confidence = DecodeConfidence.EXACT;
        for (final AttributedDamage damage : events) {
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
                ReplayTimestamp.safeClockSec(events.getFirst().event().timestamp()),
                ReplayTimestamp.safeClockSec(events.getLast().event().timestamp()),
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
            final Map<Integer, List<PositionChangedEvent>> positionsByEntity,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final BattleStartResolution battleStartRes
    ) {
        final Map<Integer, Map<String, PositionChangedEvent>> windows = new HashMap<>();
        positionsByEntity.forEach((entityId, positions) -> {
            final TeamEntityIdentity identity = mapping.identity(entityId);
            if (identity == null || identity.team() != perspectiveTeam) {
                return;
            }
            for (final PositionChangedEvent position : positions) {
                    final float rawClock = ReplayTimestamp.safeClockSec(position.timestamp());
                    final float activeClock = battleStartRes != null ? battleStartRes.battleRelative(rawClock) : rawClock;
                    final int window = (int) Math.floor(activeClock / FORMATION_WINDOW_SEC);
                    windows.computeIfAbsent(window, ignored -> new HashMap<>())
                            .merge(identityKey(identity), position,
                                    (left, right) -> left.sequence() > right.sequence() ? left : right);
            }
        });
        return windows.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> formationPhase(entry.getKey(), entry.getValue()))
                .toList();
    }

    private static TeamFormationPhase formationPhase(
            final int window,
            final Map<String, PositionChangedEvent> positionsByMember
    ) {
        final List<Map.Entry<String, PositionChangedEvent>> sorted = positionsByMember.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .toList();
        final List<PositionChangedEvent> positions = sorted.stream()
                .map(Map.Entry::getValue)
                .toList();
        final float centroidX = (float) positions.stream()
                .mapToDouble(PositionChangedEvent::x)
                .average()
                .orElse(0.0);
        final float centroidY = (float) positions.stream()
                .mapToDouble(PositionChangedEvent::y)
                .average()
                .orElse(0.0);
        final float centroidZ = (float) positions.stream()
                .mapToDouble(PositionChangedEvent::z)
                .average()
                .orElse(0.0);
        final float dispersion = (float) positions.stream()
                .mapToDouble(position -> distance(
                        position.x(), position.z(), centroidX, centroidZ))
                .average()
                .orElse(0.0);
        final DecodeConfidence confidence = positions.stream()
                .map(PositionChangedEvent::confidence)
                .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);

        // Build structured clusters
        final float windowStart = window * FORMATION_WINDOW_SEC;
        final float windowEnd = (window + 1) * FORMATION_WINDOW_SEC;
        final List<TeamFormationCluster> clusters = buildClusters(sorted, windowStart, windowEnd);

        return new TeamFormationPhase(
                window * FORMATION_WINDOW_SEC,
                (window + 1) * FORMATION_WINDOW_SEC,
                new Vector3(centroidX, centroidY, centroidZ),
                dispersion,
                positions.size(),
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
                    if (!visited[candidate] && distance(
                            currentPos.x(), currentPos.z(),
                            sorted.get(candidate).getValue().x(),
                            sorted.get(candidate).getValue().z())
                            <= FORMATION_CLUSTER_DISTANCE) {
                        visited[candidate] = true;
                        queue.add(candidate);
                    }
                }
            }

            // Compute cluster centroid and convert to canonical
            final float rawCx = (float) clusterIndices.stream()
                    .mapToDouble(i -> sorted.get(i).getValue().x())
                    .average().orElse(0.0);
            final float rawCz = (float) clusterIndices.stream()
                    .mapToDouble(i -> sorted.get(i).getValue().z())
                    .average().orElse(0.0);
            final MapCoordinateResolution coordRes = MapRegionResolver.resolve(rawCx, rawCz);
            if (!coordRes.usable()) continue;
            final CanonicalMapPosition canon = coordRes.position();
            final int region = canon.region();
            final List<String> identities = clusterIndices.stream()
                    .map(i -> sorted.get(i).getKey())
                    .sorted()
                    .toList();
            final int clampedPosCount = (int) clusterIndices.stream()
                    .map(i -> sorted.get(i).getValue())
                    .filter(pos -> MapRegionResolver.resolve(pos.x(), pos.z()).status()
                            == MapCoordinateResolution.Status.CLAMPED)
                    .count();
            final DecodeConfidence clusterConfidence = clusterIndices.stream()
                    .map(i -> sorted.get(i).getValue().confidence())
                    .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);

            result.add(new TeamFormationCluster(
                    startTime, endTime, canon, coordRes.status(), region, clampedPosCount, identities, clusterConfidence));
        }

        // Sort by startTime, region, centroidX, centroidZ, then member identities
        result.sort(Comparator.comparingInt((TeamFormationCluster c) -> c.region())
                .thenComparingDouble(c -> c.centroidX())
                .thenComparingDouble(c -> c.centroidZ()));
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

    private static boolean usablePositionEvidence(
            final PositionChangedEvent position
    ) {
        return position.confidence() != DecodeConfidence.UNKNOWN
                && hasUsableClock(position)
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
        final float clock = ReplayTimestamp.safeClockSec(event.timestamp());
        return Float.isFinite(clock) && clock >= 0f;
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
            final List<AttributedDamage> damages,
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
        damages.stream()
                .filter(damage -> involvesTeam(damage, perspectiveTeam))
                .min(Comparator
                        .comparingDouble((AttributedDamage damage) ->
                                ReplayTimestamp.safeClockSec(damage.event().timestamp()))
                        .thenComparingInt(damage -> damage.event().sequence()))
                .ifPresent(damage -> events.add(new KeyBattleEvent(
                        ReplayTimestamp.safeClockSec(damage.event().timestamp()),
                        "TEAM_FIRST_CONTACT",
                        "damage=" + damage.event().damage(),
                        lowestConfidence(damage),
                        "REPLAY_EVENT",
                        List.of(damage.event().attackerEid(), damage.event().victimEid()))));
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
            events.add(new KeyBattleEvent(
                    battleEnd.clockSec(),
                    "BATTLE_END",
                    battle != null && battle.winnerTeam != null
                            ? "winnerTeam=" + battle.winnerTeam : "winnerTeam=UNKNOWN",
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

    private static BattleEndEvidence findBattleEndEvidence(
            final List<ReplayEvent> events,
            final Battle battle
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
                .filter(event -> Float.isFinite(
                        ReplayTimestamp.safeClockSec(event.timestamp())))
                .filter(event -> ReplayTimestamp.safeClockSec(event.timestamp()) >= 0f)
                .findFirst()
                .map(event -> new BattleEndEvidence(
                        ReplayTimestamp.safeClockSec(event.timestamp()),
                        event.confidence() == null
                                ? DecodeConfidence.UNKNOWN : event.confidence(),
                        "REPLAY_EVENT"))
                .orElse(BattleEndEvidence.unknown());
    }

    private static float lastObservedClock(final List<ReplayEvent> events) {
        return (float) events.stream()
                .map(ReplayEvent::timestamp)
                .filter(timestamp -> timestamp != null)
                .mapToDouble(ReplayTimestamp::safeClockSec)
                .filter(Double::isFinite)
                .filter(clock -> clock >= 0.0)
                .max()
                .orElse(0.0);
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
            int clampedCount,
            int outOfBoundsCount
    ) {
    }

    private record BattleEndEvidence(
            Float clockSec,
            DecodeConfidence confidence,
            String source
    ) {

        private static BattleEndEvidence unknown() {
            return new BattleEndEvidence(
                    null, DecodeConfidence.UNKNOWN, "UNKNOWN");
        }
    }
}
