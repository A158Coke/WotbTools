package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * 团队关键事件提取器：成员阵亡/首次接火/队形分裂/战斗结束 KeyBattleEvent，
 * 阵亡时主力质心距离（DeathProximity）与事件流结束时刻/置信度解析。
 * <p>从 {@link DefaultTeamBattleFeatureExtractor} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamKeyEventsExtractor {

    private TeamKeyEventsExtractor() {
    }

    static String buildResultLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return "result=DRAW_OR_UNKNOWN";
        }
        return switch (FriendlyEnemyResult.resolveTeamBattle(battle, perspectiveTeam).winner()) {
            case FRIENDLY_WIN -> "result=TEAM_WIN";
            case ENEMY_WIN -> "result=TEAM_LOSS";
            case DRAW_OR_UNKNOWN -> "result=DRAW_OR_UNKNOWN";
        };
    }

    /**
     * 阵亡时刻与主力质心（其余 OBSERVED 本队车辆平均位置）的实际距离。
     * 目标位置取阵亡时刻前后最近的 OBSERVED 记录；无 OBSERVED 位置时返回 null（禁止硬算）。
     */
    static TeamMemberFeatureSet.DeathProximity resolveDeathProximity(
            final ReplayReconstruction recon,
            final TeamEntityMapping mapping,
            final String mapCode,
            final int perspectiveTeam,
            final PlayerResult player) {
        if (player.survived || recon == null || recon.checkpoints() == null
                || recon.checkpoints().isEmpty()) {
            return null;
        }
        final double deathSec = PlayerResultFormat.deathSec(player);
        if (deathSec <= 0) {
            return null;
        }
        final Float startRaw = recon.battleStartRawClockSec();
        final float deathRaw = startRaw == null ? (float) deathSec : startRaw + (float) deathSec;
        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));
        final List<Integer> entityIds = mapping.entityIds(player.accountId, player.nickname);
        if (entityIds.isEmpty()) {
            return null;
        }
        BattleStateCheckpoint nearest = null;
        float bestDiff = Float.MAX_VALUE;
        for (final BattleStateCheckpoint cp : sorted) {
            final float diff = Math.abs(cp.rawClockSec() - deathRaw);
            if (diff < bestDiff) {
                bestDiff = diff;
                nearest = cp;
            }
        }
        if (nearest == null) {
            return null;
        }
        Vector3 memberPos = null;
        float memberClock = 0f;
        for (int i = sorted.indexOf(nearest); i >= 0; i--) {
            final BattleStateCheckpoint cp = sorted.get(i);
            for (final int eid : entityIds) {
                final VehicleState vs = cp.stateSnapshot().vehicleByEntityId(eid);
                if (vs != null && vs.position() != null
                        && vs.observationState() == ObservationState.OBSERVED) {
                    memberPos = vs.position();
                    memberClock = cp.rawClockSec();
                    break;
                }
            }
            if (memberPos != null) {
                break;
            }
        }
        if (memberPos == null) {
            return null;
        }
        final double deltaSec = Math.abs(memberClock - deathRaw);
        final float[] centroid = friendlyCentroidAt(nearest, perspectiveTeam, entityIds);
        if (centroid == null) {
            return null;
        }
        final float distance = MapRegionResolver.canonicalDistanceMeters(
                memberPos.x(), memberPos.z(), centroid[0], centroid[1], mapCode);
        if (distance < 0f) {
            return null;
        }
        final DecodeConfidence confidence = deltaSec <= 3.0
                ? DecodeConfidence.EXACT
                : deltaSec <= 15.0 ? DecodeConfidence.INFERRED : DecodeConfidence.PARTIAL;
        return new TeamMemberFeatureSet.DeathProximity((double) distance, deltaSec, confidence);
    }

    /** 某时刻本队其它 OBSERVED 车辆的原始坐标质心。 */
    static float[] friendlyCentroidAt(
            final BattleStateCheckpoint cp,
            final int perspectiveTeam,
            final List<Integer> excludedEntityIds) {
        float sumX = 0;
        float sumZ = 0;
        int count = 0;
        for (final VehicleState vs : cp.stateSnapshot().vehiclesByEntityId().values()) {
            if (excludedEntityIds.contains(vs.entityId())
                    || vs.position() == null
                    || vs.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final Integer team = vs.team();
            if (team == null || team != perspectiveTeam) {
                continue;
            }
            sumX += vs.position().x();
            sumZ += vs.position().z();
            count++;
        }
        return count == 0 ? null : new float[]{sumX / count, sumZ / count};
    }

    static List<KeyBattleEvent> buildKeyEvents(
            final Battle battle,
            final List<PlayerResult> members,
            final TeamEntityMapping mapping,
            final List<DefaultTeamBattleFeatureExtractor.TimedTeamDamage> timedDamages,
            final List<TeamFormationPhase> formationPhases,
            final int perspectiveTeam,
            final BattleEndResolver.BattleEndResult battleEndResolved,
            final DecodeConfidence eventEndConfidence
    ) {
        final Stream<KeyBattleEvent> deathEvents = members.stream()
                .filter(member -> !member.survived)
                .filter(member -> PlayerResultFormat.deathSec(member) > 0)
                .sorted(Comparator.comparingDouble(PlayerResultFormat::deathSec))
                .map(member -> new KeyBattleEvent(
                        (float) PlayerResultFormat.deathSec(member),
                        "TEAM_MEMBER_DESTROYED",
                        "accountId=" + member.accountId + ";nickname=" + member.nickname,
                        DecodeConfidence.EXACT,
                        "BATTLE_RESULTS",
                        mapping.entityIds(member.accountId, member.nickname)));
        final Stream<KeyBattleEvent> firstContact = timedDamages.stream()
                .filter(td -> DefaultTeamBattleFeatureExtractor.involvesTeam(td.event(), perspectiveTeam))
                .min(Comparator
                        .comparingDouble(DefaultTeamBattleFeatureExtractor.TimedTeamDamage::battleRelativeSec)
                        .thenComparingInt(td -> td.event().event().sequence()))
                .map(td -> new KeyBattleEvent(
                        td.battleRelativeSec(),
                        "TEAM_FIRST_CONTACT",
                        // §13：伤害数字只用可证明的掉血（单通知归属）；不可归属 → unknown
                        "damage=" + (td.trustedHpLoss() == null ? "unknown" : td.trustedHpLoss()),
                        lowestConfidence(td.event()),
                        "REPLAY_EVENT",
                        List.of(td.event().event().attackerEid(), td.event().event().victimEid())))
                .stream();
        final Stream<KeyBattleEvent> formationSplit = formationPhases.stream()
                .filter(phase -> phase.observedMemberCount() > 1 && phase.clusterCount() > 1)
                .findFirst()
                .map(phase -> new KeyBattleEvent(
                        phase.startTime(),
                        "TEAM_FORMATION_SPLIT",
                        "clusters=" + phase.clusterCount()
                                + ";dispersion=" + String.format(java.util.Locale.ROOT, "%.1f",
                                phase.averageDispersion()),
                        phase.confidence(),
                        "DERIVED_POSITION",
                        List.of()))
                .stream();
        final DecodeConfidence endConfidence = switch (battleEndResolved.source()) {
            case BATTLE_RESULTS -> DecodeConfidence.EXACT;
            case REPLAY_EVENT -> eventEndConfidence != null ? eventEndConfidence : DecodeConfidence.UNKNOWN;
            default -> null;
        };
        final Stream<KeyBattleEvent> battleEndEvent = battleEndResolved.resolved() && endConfidence != null
                ? Stream.of(new KeyBattleEvent(
                        battleEndResolved.battleEndRelativeSec(),
                        "BATTLE_END",
                        buildResultLabel(battle, perspectiveTeam),
                        endConfidence,
                        battleEndResolved.source().name(),
                        List.of()))
                : Stream.empty();
        return Stream.of(deathEvents, firstContact, formationSplit, battleEndEvent)
                .flatMap(s -> s)
                .sorted(Comparator.comparingDouble(KeyBattleEvent::clockSec)
                        .thenComparing(KeyBattleEvent::type))

                .toList();
    }

    /**
     * Battle-relative fallback clock: the latest observed raw event clock converted through
     * {@code battleStartRes}. Never mixes raw replay clock with battle-relative duration.
     */
    static Float lastObservedClock(
            final List<ReplayEvent> events,
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent
    ) {
        return events.stream()
                .map(resolutionByEvent::get)
                .filter(Objects::nonNull)
                .filter(TacticalTimeResolution::isUsable)
                .map(TacticalTimeResolution::battleRelativeSec)
                .max(Float::compare)
                .orElse(null);
    }

    static Float findEventEnd(
            final List<ReplayEvent> events,
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent
    ) {
        return events.stream()
                .filter(BattleEndedEvent.class::isInstance)
                .map(BattleEndedEvent.class::cast)
                .filter(event -> {
                    final TacticalTimeResolution res = resolutionByEvent.get(event);
                    return res != null && res.isUsable();
                })
                .map(event -> resolutionByEvent.get(event).battleRelativeSec())
                .filter(clock -> Float.isFinite(clock) && clock >= 0f)
                .findFirst()
                .orElse(null);
    }

    static DecodeConfidence findEventEndConfidence(
            final List<ReplayEvent> events,
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent
    ) {
        return events.stream()
                .filter(BattleEndedEvent.class::isInstance)
                .map(BattleEndedEvent.class::cast)
                .filter(event -> {
                    final TacticalTimeResolution res = resolutionByEvent.get(event);
                    return res != null && res.isUsable();
                })
                .findFirst()
                .map(event -> event.confidence() != null ? event.confidence() : DecodeConfidence.UNKNOWN)
                .orElse(DecodeConfidence.UNKNOWN);
    }

    static DecodeConfidence lowestConfidence(final DefaultTeamBattleFeatureExtractor.AttributedDamage damage) {
        return DefaultTeamBattleFeatureExtractor.lowerConfidence(
                damage.event().confidence(),
                DefaultTeamBattleFeatureExtractor.lowerConfidence(
                        damage.attacker().confidence(),
                        damage.victim().confidence()));
    }

}