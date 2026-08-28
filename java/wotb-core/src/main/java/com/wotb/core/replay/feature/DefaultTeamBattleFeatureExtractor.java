package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;

import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.springframework.util.StringUtils;
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
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 默认队伍特征提取器。
 * 所有位置与伤害归因都依赖 {@link TeamEntityMapper}，未知实体不会进入本队统计。
 */
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
                reconstruction != null ? reconstruction.diagnostics() : null,
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
                    resolveDeathProximity(reconstruction, entityMapping, mapCode, perspectiveTeam, p));
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
                teamPositionsByEntity(events, entityMapping, perspectiveTeam, resolutionByEvent, mapCode);
        final PositionEvidenceAudit positionAudit =
                auditPositionEvidence(events, entityMapping, perspectiveTeam, resolutionByEvent, mapCode, battle);
        final int invalidTimestampEventCount = (int) resolvedEvents.stream()
                .filter(re -> re.resolution().status() == TacticalTimeResolution.Status.INVALID_TIMESTAMP)
                .count();
        // §11–§17：伤害/掉血事实只消费权威 HP loss（Type-7 推导 + attacker attribution）。
        // Type-8 rawProtocolValue 语义未证明，不得作为 dealt/received/关键事件伤害。
        final Float battleStartRaw = reconstruction == null ? null
                : reconstruction.battleStartRawClockSec();
        final double duration = reconstruction != null && reconstruction.replayDurationSec() > 0
                ? reconstruction.replayDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        final PlaybackCombatReconstruction.Result combat = PlaybackCombatReconstruction.derive(
                events, entityMapping,
                battleStartRaw == null ? 0.0 : battleStartRaw.doubleValue(), duration);
        // 涉及本队视角的掉血记录（victim 属本队，或 reliable attacker 属本队）；
        // attacker 可能为 null = 不可归属（掉血真实发生但不得计入任何攻击者）
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
            // 事件级可信掉血：仅单通知窗口归属（多通知/无通知 → null，聚合走 loss 级）
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

        // AoI 离开边界（Type4）：成员移动段必须在离开时刻断开（禁止跨 AoI gap 合并/插值）
        final Map<Integer, List<Double>> leaveTimesByEntity = new LinkedHashMap<>();
        for (final ReplayEvent event : events) {
            if (!(event instanceof com.wotb.core.replay.event.EntityRemovedEvent removed)) {
                continue;
            }
            final TacticalTimeResolution res = resolutionByEvent.get(event);
            if (res == null || !res.isUsable()) {
                continue;
            }
            leaveTimesByEntity.computeIfAbsent(removed.entityId(), k -> new ArrayList<>())
                    .add((double) res.battleRelativeSec());
        }

        final List<TeamMemberFeatureSet> members = authoritativeMembers.stream()
                .map(player -> buildMember(
                        player, entityMapping, timedPositionsByEntity, leaveTimesByEntity,
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
                .filter(pos -> TeamFormationExtractor.isClamped(pos, mapCode))
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
        // 事件流迄今仅逆向出 sub3 直接伤害子类型；只有当观测聚合与权威结算不一致
        // （覆盖未达 100%）时才标记 PARTIAL，触发 prompt 层抑制观测数字。
        // 覆盖补齐后（观测=权威）该 limitation 自动消失，数字恢复输出。
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
        if (reconstructionAvailable && reconstruction.coverage() != null && !streamComplete) {
            limitations.add("REPLAY_STREAM_PARTIAL");
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

    private static Map<Integer, List<PositionChangedEvent>> teamPositionsByEntity(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent,
            final String mapCode
    ) {
        return events.stream()
                .filter(PositionChangedEvent.class::isInstance)
                .map(PositionChangedEvent.class::cast)
                .filter(position -> {
                    final TacticalTimeResolution res = resolutionByEvent.get(position);
                    return res != null && res.isUsable();
                })
                .filter(pos -> TeamFormationExtractor.usableSpatialEvidence(pos, mapCode))
                .filter(position -> {
                    final TeamEntityIdentity identity = mapping.identity(position.entityId());
                    return identity != null && identity.usable()
                            && identity.team() == perspectiveTeam;
                })
                .collect(Collectors.groupingBy(
                        PositionChangedEvent::entityId,
                        LinkedHashMap::new,
                        Collectors.collectingAndThen(
                                Collectors.toList(),
                                list -> {
                                    list.sort(Comparator.comparingInt(PositionChangedEvent::sequence));
                                    return list;
                                })));
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
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent,
            final String mapCode,
            final Battle battle
    ) {
        // 实际参战账号权威集合 = battle_results #301（actual combatant source，唯一权威）；
        // 观战/辅助实体只出现在 #201/updateArena2/event stream，不属于 #301。
        final Set<Long> combatantAccounts = new LinkedHashSet<>();
        final Set<String> combatantNicknames = new LinkedHashSet<>();
        if (battle != null && battle.players != null) {
            for (final PlayerResult player : battle.players) {
                if (player == null) {
                    continue;
                }
                if (player.accountId > 0) {
                    combatantAccounts.add(player.accountId);
                }
                if (StringUtils.hasText(player.nickname)) {
                    combatantNicknames.add(player.nickname);
                }
            }
        }
        // entity -> 映射账号/昵称（来自 updateArena2 roster 映射事件；未映射实体（观战镜头/场景对象）不在其中）。
        // 昵称映射（accountId=0）也可能指向 #301 成员（如昵称重名导致 TeamEntityMapper 无法归因），
        // 需一并纳入 A/B 分类，避免把 #301 成员实体的位置误判为非参战。
        final Map<Integer, Long> accountByEntity = new HashMap<>();
        final Map<Integer, String> nicknameByEntity = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (event instanceof ParticipantMappingEvent pm) {
                if (pm.accountId() > 0) {
                    accountByEntity.putIfAbsent(pm.entityId(), pm.accountId());
                } else if (StringUtils.hasText(pm.nickname())) {
                    nicknameByEntity.putIfAbsent(pm.entityId(), pm.nickname());
                }
            }
        }
        int unattributedCombatantCount = 0;
        int nonCombatantPositionCount = 0;
        int outOfBoundsCount = 0;
        for (final ReplayEvent event : events) {
            if (!(event instanceof PositionChangedEvent position)) {
                continue;
            }
            final TacticalTimeResolution res = resolutionByEvent.get(event);
            if (res == null || !res.isUsable()) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(position.entityId());
            if (identity == null || !identity.usable()) {
                // A. actual combatant（#301）实体无法归因 -> 真实数据质量问题
                final Long mappedAccount = accountByEntity.get(position.entityId());
                final String mappedNickname = nicknameByEntity.get(position.entityId());
                final boolean combatantEntity = mappedAccount != null
                        && combatantAccounts.contains(mappedAccount)
                        || mappedNickname != null && combatantNicknames.contains(mappedNickname);
                if (combatantEntity) {
                    unattributedCombatantCount++;
                } else {
                    // B. 非参战实体（观战玩家/镜头/场景对象）-> 战术证据忽略，仅 internal diagnostic
                    nonCombatantPositionCount++;
                }
                continue;
            }
            if (identity.team() != perspectiveTeam) {
                continue; // enemy position, not counted in perspective coverage
            }
            if (TeamFormationExtractor.isOutOfBounds(position, mapCode)) {
                outOfBoundsCount++;
            }
        }
        return new PositionEvidenceAudit(
                unattributedCombatantCount, nonCombatantPositionCount, outOfBoundsCount);
    }

    private static TeamMemberFeatureSet buildMember(
            final PlayerResult player,
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
        // mapping 根本不存在 → mapping failure；mapping 存在但没有 usable position → position failure。
        // 避免对同一个完全 unmapped 成员重复披露两个派生 limitation（P2 cleanup）。
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

    /** 包内 forwarder：新逻辑在 TeamKeyEventsExtractor，此入口供 DeathProximityTest 直接调用。 */
    static TeamMemberFeatureSet.DeathProximity resolveDeathProximity(
            final ReplayReconstruction recon,
            final TeamEntityMapping mapping,
            final String mapCode,
            final int perspectiveTeam,
            final PlayerResult player) {
        return TeamKeyEventsExtractor.resolveDeathProximity(recon, mapping, mapCode, perspectiveTeam, player);
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

    /** 账号 → 身份（re-entry 取首个实体）；无 → null。 */
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

    private record PositionEvidenceAudit(
            int unattributedCombatantCount,
            int nonCombatantPositionCount,
            int outOfBoundsCount
    ) {
    }

    record ResolvedEvent(ReplayEvent event, TacticalTimeResolution resolution) {}

    /** 事件级掉血记录：trustedHpLoss = 该事件可证明的掉血（单通知窗口归属；null = 无法归属到单事件）。 */
    record TimedTeamDamage(AttributedDamage event, float battleRelativeSec, Integer trustedHpLoss) {}

    /** 掉血记录（loss 级，聚合用）：attacker 可为 null（不可归属——不得计入任何攻击者）。 */
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
