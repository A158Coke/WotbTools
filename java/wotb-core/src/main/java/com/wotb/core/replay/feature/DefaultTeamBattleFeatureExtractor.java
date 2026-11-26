package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
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
import java.util.stream.Stream;

public class DefaultTeamBattleFeatureExtractor {
    public TeamBattleFeatureSet extract(
            final Battle battle,
            final ReplayReconstruction reconstruction,
            final TeamPerspectiveResolution perspective
    ) {
        if (perspective == null || !perspective.resolved()) {
            return TeamBattleFeatureSet.empty(0);
        }

        final String mapCode = battle == null ? null : battle.mapName;
        final int perspectiveTeam = perspective.perspectiveTeam();
        final BattleStartResolution battleStartRes = BattleStartResolver.resolve(
                reconstruction != null ? reconstruction.battleStartRawClockSec() : null,
                reconstruction != null && reconstruction.events() != null ? reconstruction.events() : List.of(),
                battle);
        final List<ReplayEvent> events = reconstruction != null && reconstruction.events() != null
                ? reconstruction.events().stream()
                        .sorted(Comparator.comparingInt(ReplayEvent::sequence))
                        .toList()
                : List.of();
        final TeamEntityMapping entityMapping = TeamEntityMapper.resolve(battle, reconstruction);
        final List<PlayerResult> authoritativeMembers = TeamAggregateExtractor.authoritativeMembers(battle, perspectiveTeam);
        final Map<Long, TeamMemberFeatureSet.DeathProximity> deathProxByAcc = new HashMap<>();
        for (final PlayerResult p : authoritativeMembers) {
            deathProxByAcc.put(p.accountId,
                    resolveDeathProximity(battle, reconstruction, entityMapping, mapCode, perspectiveTeam, p));
        }
        final TeamAggregateResult authoritativeAggregate = TeamAggregateExtractor.buildAuthoritativeAggregate(
                battle, authoritativeMembers, perspectiveTeam);

        final List<ResolvedEvent> resolvedEvents = events.stream()
                .map(event -> new ResolvedEvent(event, battleStartRes.tryRelative(event.timestamp())))
                .toList();
        final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent = new HashMap<>();
        for (final ResolvedEvent re : resolvedEvents) {
            resolutionByEvent.put(re.event(), re.resolution());
        }
        final Set<String> timeLimitations = new LinkedHashSet<>();
        for (final ResolvedEvent re : resolvedEvents) {
            final String limitation = re.resolution().limitation();
            if (limitation != null) {
                timeLimitations.add(limitation);
            }
        }

        final Map<Integer, List<PositionChangedEvent>> positionsByEntity =
                TeamPositionEvidenceExtractor.teamPositionsByEntity(
                        events, entityMapping, perspectiveTeam, resolutionByEvent,
                        position -> TeamFormationExtractor.usableSpatialEvidence(position, mapCode));
        final TeamPositionEvidenceExtractor.PositionEvidenceAudit positionAudit =
                TeamPositionEvidenceExtractor.auditPositionEvidence(
                        events, entityMapping, perspectiveTeam, resolutionByEvent, battle,
                        position -> TeamFormationExtractor.isOutOfBounds(position, mapCode));
        final int invalidTimestampEventCount = (int) resolvedEvents.stream()
                .filter(re -> re.resolution().status() == TacticalTimeResolution.Status.INVALID_TIMESTAMP)
                .count();
        final Float battleStartRaw = reconstruction == null ? null
                : reconstruction.battleStartRawClockSec();
        final double duration = reconstruction != null && reconstruction.battleDurationSec() > 0
                ? reconstruction.battleDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        final PlaybackCombatReconstruction.Result combat = PlaybackCombatReconstruction.derive(
                events, entityMapping,
                battleStartRaw == null ? 0.0 : battleStartRaw.doubleValue(), duration, battle);
        final List<AttributedHpLoss> teamLosses = new ArrayList<>();
        for (final java.util.Map.Entry<Long,
                List<PlaybackCombatReconstruction.Loss>> entry
                : combat.lossesByVictim().entrySet()) {
            final TeamEntityIdentity victimId = identityOfAccount(entityMapping, entry.getKey());
            for (final PlaybackCombatReconstruction.Loss loss : entry.getValue()) {
                final Long attackerAccount = loss.attackerAccountId();
                final TeamEntityIdentity attackerId = loss.attackerReliable()
                        && attackerAccount != null
                        ? identityOfAccount(entityMapping, attackerAccount) : null;
                final boolean victimInTeam = victimId != null && victimId.team() == perspectiveTeam;
                final boolean attackerInTeam = attackerId != null
                        && attackerId.team() == perspectiveTeam;
                if (victimInTeam || attackerInTeam) {
                    teamLosses.add(new AttributedHpLoss(loss, attackerId, victimId));
                }
            }
        }
        int unattributedDamageCount = (int) teamLosses.stream()
                .filter(loss -> loss.attacker() == null || !loss.loss().attackerReliable())
                .count();

        final List<TimedTeamDamage> timedDamages = new ArrayList<>();
        for (final ReplayEvent event : events) {
            if (!(event instanceof DamageEvent damage) || damage.damage() <= 0) {
                continue;
            }
            final TacticalTimeResolution res = resolutionByEvent.get(event);
            if (res == null || !res.isUsable()) {
                continue;
            }
            final TeamEntityIdentity attacker = entityMapping.identity(damage.attackerEid());
            final TeamEntityIdentity victim = entityMapping.identity(damage.victimEid());
            if (!TeamAggregateExtractor.usableDamageEvidence(damage, attacker, victim)) {
                continue;
            }
            final long victimAccount = victim != null ? victim.accountId() : 0L;
            final Integer trustedHpLoss = victimAccount > 0
                    ? PlaybackCombatReconstruction.observedHpLossAt(
                            combat, victimAccount, res.battleRelativeSec())
                    : null;
            final AttributedDamage ad = new AttributedDamage(damage, attacker, victim);
            timedDamages.add(new TimedTeamDamage(ad, res.battleRelativeSec(), trustedHpLoss));
        }

        final Map<Integer, List<TimedTeamPosition>> timedPositionsByEntity = new LinkedHashMap<>();
        for (final Map.Entry<Integer, List<PositionChangedEvent>> entry : positionsByEntity.entrySet()) {
            final List<TimedTeamPosition> timedList = entry.getValue().stream()
                    .map(pos -> new TimedTeamPosition(pos, resolutionByEvent.get(pos).battleRelativeSec()))
                    .toList();
            timedPositionsByEntity.put(entry.getKey(), timedList);
        }
        final List<ReplayEvent> acceptedEvents = Stream.<ReplayEvent>concat(
                timedPositionsByEntity.values().stream().flatMap(List::stream).map(TimedTeamPosition::event),
                timedDamages.stream()
                        .filter(td -> involvesTeam(td.event(), perspectiveTeam))
                        .map(d -> d.event().event())
        ).toList();
        final boolean hasUsableTimedEvent = !acceptedEvents.isEmpty();

        final Double teamStartRaw = battleStartRaw == null ? null : battleStartRaw.doubleValue();
        final Map<Integer, List<Double>> leaveTimesByEntity = new LinkedHashMap<>();
        for (final com.wotb.core.replay.facts.AoiObservationSegment segment
                : com.wotb.core.replay.facts.ReplayAoiLifecycle.build(events, teamStartRaw)) {
            if (segment.absentFromSec() == null) {
                continue;
            }
            leaveTimesByEntity.computeIfAbsent(segment.entityId(), k -> new ArrayList<>())
                    .add(segment.absentFromSec());
        }

        final List<TeamMemberFeatureSet> members = authoritativeMembers.stream()
                .map(player -> buildMember(
                        player, battle, entityMapping, timedPositionsByEntity, leaveTimesByEntity,
                        timedDamages, teamLosses,
                        authoritativeMembers, mapCode,
                        deathProxByAcc.getOrDefault(player.accountId, null)))
                .sorted(Comparator.comparingLong(TeamMemberFeatureSet::accountId)
                        .thenComparing(TeamMemberFeatureSet::nickname,
                                Comparator.nullsLast(String::compareTo)))
                .toList();
        final List<TeamEngagementSummary> engagements = TeamEngagementExtractor.buildTeamEngagements(
                timedDamages, teamLosses, perspectiveTeam);
        final TeamObservedAggregate observedAggregate = TeamAggregateExtractor.buildObservedAggregate(
                timedDamages, teamLosses, perspectiveTeam, unattributedDamageCount);
        final List<TeamFormationPhase> formationPhases = TeamFormationExtractor.buildFormationPhases(
                timedPositionsByEntity, entityMapping, perspectiveTeam, mapCode);
        final float firstContactTime = timedDamages.stream()
                .filter(td -> involvesTeam(td.event(), perspectiveTeam))
                .mapToDouble(TimedTeamDamage::battleRelativeSec)
                .min()
                .stream()
                .mapToObj(value -> (float) value)
                .findFirst()
                .orElse(-1f);
        final Float eventEnd = TeamKeyEventsExtractor.findEventEnd(events, resolutionByEvent);
        final Float scopeLocalEnd = TeamKeyEventsExtractor.lastObservedClock(acceptedEvents, resolutionByEvent);
        final BattleEndResolver.BattleEndResult battleEndResolved = BattleEndResolver.resolve(
                battle, eventEnd, scopeLocalEnd);
        final float phaseEndClock = battleEndResolved.battleEndRelativeSec() != null
                ? battleEndResolved.battleEndRelativeSec() : Float.NaN;
        final List<BattlePhaseSummary> battlePhases = hasUsableTimedEvent
                ? BattlePhaseSummary.buildRelativePhasesWithSurvival(
                        firstContactTime, phaseEndClock,
                        BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle, perspectiveTeam))
                : List.of();
        final DecodeConfidence eventEndConfidence = TeamKeyEventsExtractor.findEventEndConfidence(events, resolutionByEvent);
        final List<KeyBattleEvent> keyEvents = TeamKeyEventsExtractor.buildKeyEvents(
                battle, authoritativeMembers, entityMapping, timedDamages,
                formationPhases, perspectiveTeam, battleEndResolved, eventEndConfidence);

        final int mappedMembers = entityMapping.mappedMembers(perspectiveTeam);
        final int observedPositionEventCount = (int) timedPositionsByEntity.values().stream()
                .flatMap(List::stream)
                .count();
        final int clampedPositionEventCount = (int) timedPositionsByEntity.values().stream()
                .flatMap(List::stream)
                .map(TimedTeamPosition::event)
                .filter(pos -> TeamFormationExtractor.isClamped(pos, mapCode))
                .count();
        final boolean reconstructionAvailable = reconstruction != null;
        final boolean fullFeaturesAvailable = reconstructionAvailable
                && mappedMembers > 0
                && (observedPositionEventCount > 0 || !engagements.isEmpty());
        final Double decodedRatio = reconstructionAvailable
                && reconstruction.coverage() != null
                ? Double.valueOf(reconstruction.coverage().decodedPacketRatio()) : null;
        final TeamFeatureCoverage coverage = new TeamFeatureCoverage(
                authoritativeAggregate != null,
                reconstructionAvailable,
                authoritativeMembers.size(),
                mappedMembers,
                observedPositionEventCount,
                timedDamages.size(),
                unattributedDamageCount,
                positionAudit.unattributedCombatantCount(),
                positionAudit.nonCombatantPositionCount(),
                clampedPositionEventCount,
                positionAudit.outOfBoundsCount(),
                invalidTimestampEventCount,
                decodedRatio,
                fullFeaturesAvailable);

        final Set<String> limitations = new LinkedHashSet<>(perspective.limitations());
        limitations.addAll(entityMapping.limitations());
        if (battleStartRes.limitation() != null) {
            limitations.add(battleStartRes.limitation());
        }
        final boolean observedMatchesAuthoritative = authoritativeAggregate != null
                && observedAggregate != null
                && ObservedDamageCoverage.matches(
                        observedAggregate.damageDealt(),
                        observedAggregate.damageReceived(),
                        authoritativeAggregate.totalDamageDealt(),
                        authoritativeAggregate.totalDamageReceived());
        if (!observedMatchesAuthoritative) {
            limitations.add("OBSERVED_DAMAGE_IS_PARTIAL");
        }
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
        if (positionAudit.unattributedCombatantCount() > 0) {
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
        limitations.addAll(timeLimitations);
        if (battleEndResolved.limitation() != null) {
            limitations.add(battleEndResolved.limitation());
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

    private static TeamMemberFeatureSet buildMember(
            final PlayerResult player,
            final Battle battle,
            final TeamEntityMapping mapping,
            final Map<Integer, List<TimedTeamPosition>> timedPositionsByEntity,
            final Map<Integer, List<Double>> leaveTimesByEntity,
            final List<TimedTeamDamage> damageEvents,
            final List<AttributedHpLoss> teamLosses,
            final List<PlayerResult> authoritativeMembers,
            final String mapCode,
            final TeamMemberFeatureSet.DeathProximity deathProximity
    ) {
        final long memberAccountId = player.accountId;
        final String memberNickname = player.nickname;
        final MemberIdentity memberId = MemberIdentity.resolve(player, authoritativeMembers);
        final List<Integer> entityIds =
                mapping.entityIds(player.accountId, player.nickname);
        final List<MovementSegment> movements = new ArrayList<>();
        for (final int entityId : entityIds) {
            final List<TimedTeamPosition> timedPositions =
                    timedPositionsByEntity.getOrDefault(entityId, List.of());
            movements.addAll(DefaultPlayerBattleFeatureExtractor.compressMovements(
                    convertTimedPositions(timedPositions), mapCode,
                    leaveTimesByEntity.getOrDefault(entityId, List.of())));
        }
        movements.sort(Comparator.comparingDouble(MovementSegment::startTime)
                .thenComparingDouble(MovementSegment::endTime));
        final DecodeConfidence mappingConfidence = entityIds.stream()
                .map(mapping::identity)
                .filter(Objects::nonNull)
                .map(TeamEntityIdentity::confidence)
                .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);
        final List<EngagementSummary> engagements = TeamEngagementExtractor.buildMemberEngagements(
                damageEvents, teamLosses, memberId);
        final List<String> limitations = new ArrayList<>();
        if (memberId.ambiguousNickname()) {
            limitations.add("TEAM_MEMBER_IDENTITY_UNRESOLVED");
        }
        if (entityIds.isEmpty()) {
            limitations.add("TEAM_MEMBER_ENTITY_UNMAPPED");
        } else if (movements.isEmpty()) {
            limitations.add("TEAM_MEMBER_POSITION_UNAVAILABLE");
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
                deathProximity,
                movements,
                engagements,
                keyEvents,
                limitations);
    }

    static TeamMemberFeatureSet.DeathProximity resolveDeathProximity(
            final Battle battle,
            final ReplayReconstruction recon,
            final TeamEntityMapping mapping,
            final String mapCode,
            final int perspectiveTeam,
            final PlayerResult player) {
        return TeamKeyEventsExtractor.resolveDeathProximity(battle, recon, mapping, mapCode, perspectiveTeam, player);
    }

    static TeamMemberFeatureSet.DeathProximity resolveDeathProximity(
            final ReplayReconstruction recon,
            final TeamEntityMapping mapping,
            final String mapCode,
            final int perspectiveTeam,
            final PlayerResult player) {
        return resolveDeathProximity(null, recon, mapping, mapCode, perspectiveTeam, player);
    }

    static String identityKey(final TeamEntityIdentity identity) {
        return identity.accountId() > 0
                ? "account:" + identity.accountId()
                : "nickname:" + identity.nickname();
    }

    static boolean involvesTeam(
            final AttributedDamage damage,
            final int perspectiveTeam
    ) {
        return damage.attacker().team() == perspectiveTeam
                && damage.victim().team() != perspectiveTeam
                || damage.victim().team() == perspectiveTeam
                && damage.attacker().team() != perspectiveTeam;
    }

    static DecodeConfidence lowerConfidence(
            final DecodeConfidence left,
            final DecodeConfidence right
    ) {
        return confidenceRank(left) <= confidenceRank(right) ? left : right;
    }

    private static int confidenceRank(final DecodeConfidence confidence) {
        return switch (confidence) {
            case UNKNOWN -> 0;
            case PARTIAL -> 1;
            case INFERRED -> 2;
            case EXACT -> 3;
        };
    }

    record AttributedDamage(
            DamageEvent event,
            TeamEntityIdentity attacker,
            TeamEntityIdentity victim
    ) {
    }

    static TeamEntityIdentity identityOfAccount(final TeamEntityMapping mapping, final long accountId) {
        final List<Integer> entityIds = mapping.entityIdsByAccount().getOrDefault(accountId, List.of());
        for (final int eid : entityIds) {
            final TeamEntityIdentity identity = mapping.identity(eid);
            if (identity != null) {
                return identity;
            }
        }
        return null;
    }

    record ResolvedEvent(ReplayEvent event, TacticalTimeResolution resolution) {}

    record TimedTeamDamage(AttributedDamage event, float battleRelativeSec, Integer trustedHpLoss) {}

    record AttributedHpLoss(
            PlaybackCombatReconstruction.Loss loss,
            TeamEntityIdentity attacker,
            TeamEntityIdentity victim
    ) {
    }

    record TimedTeamPosition(PositionChangedEvent event, float battleRelativeSec) {}

    private static List<DefaultPlayerBattleFeatureExtractor.TimedPosition> convertTimedPositions(
            final List<TimedTeamPosition> timedPositions) {
        return timedPositions.stream()
                .map(tp -> new DefaultPlayerBattleFeatureExtractor.TimedPosition(tp.event(), tp.battleRelativeSec()))
                .toList();
    }
}
