package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;

import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.DoubleStream;

/**
 * 默认录像者个人特征提取器。
 * 只处理 recorder entity 的位置和伤害事件。
 */
public class DefaultPlayerBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 15;
    /**
     * Stationary threshold in <strong>canonical meters</strong> (500×500 map). Centrally
     * defined here and shared by both PLAYER_FOCUSED movement and TEAM_PERSPECTIVE member
     * movement (Team reuses {@link #compressMovements}), so both use identical units.
     */
    static final float STATIONARY_THRESHOLD_METERS = 3f;

    public PlayerBattleFeatureSet extract(final ReplayReconstruction reconstruction, final RecorderEntityMapping recorder, final Battle battle) {
        if (recorder == null || !recorder.resolved() || reconstruction == null) {
            return PlayerBattleFeatureSet.empty();
        }

        final int recorderEid = recorder.entityId();
        final List<ReplayEvent> events = reconstruction.events();

        // 确定战斗开始时间（用于过滤准备阶段数据）
        final BattleStartResolution battleStartRes = BattleStartResolver.resolve(
                reconstruction.battleStartRawClockSec(),
                reconstruction.diagnostics(),
                reconstruction.events(),
                battle);

        // 过滤 recorder 的位置事件（排除准备阶段）
        final List<TimedPosition> positions = new ArrayList<>();
        final List<TimedHpLoss> damages = new ArrayList<>();
        final LinkedHashSet<String> limitationSet = new LinkedHashSet<>();
        float firstContactTime = -1f;
        float battleEndClock = Float.NaN;

        // §11–§17：伤害/掉血事实只消费权威 HP loss（Type-7 推导 + attacker attribution）。
        // Type-8 rawProtocolValue 语义未证明，不得作为 dealt/received/关键事件伤害。
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, reconstruction);
        final Float battleStartRaw = reconstruction.battleStartRawClockSec();
        final double duration = reconstruction.replayDurationSec() > 0
                ? reconstruction.replayDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        final PlaybackCombatReconstruction.Result combat = PlaybackCombatReconstruction.derive(
                events, mapping,
                battleStartRaw == null ? 0.0 : battleStartRaw.doubleValue(), duration);
        final Long recorderAccount = recorder.accountId();
        // recorder 相关的权威掉血记录（dealt 仅计 attackerReliable；received 含全部掉血）
        if (recorderAccount != null && recorderAccount > 0) {
            for (final java.util.Map.Entry<Long, List<PlaybackCombatReconstruction.Loss>> entry
                    : combat.lossesByVictim().entrySet()) {
                final long victim = entry.getKey();
                for (final PlaybackCombatReconstruction.Loss loss : entry.getValue()) {
                    final Long attacker = loss.attackerAccountId();
                    final boolean recorderIsAttacker = loss.attackerReliable()
                            && attacker != null && attacker.longValue() == recorderAccount;
                    final boolean recorderIsVictim = victim == recorderAccount;
                    if (recorderIsAttacker || recorderIsVictim) {
                        damages.add(new TimedHpLoss(loss,
                                recorderIsAttacker ? attacker : 0L,
                                victim, (float) loss.toSec()));
                    }
                }
            }
        }

        for (final ReplayEvent event : events) {
            final var res = battleStartRes.tryRelative(event.timestamp());
            switch (event) {
                case PositionChangedEvent p -> {
                    if (p.entityId() == recorderEid) {
                        if (res.isUsable()) {
                            positions.add(new TimedPosition(p, res.battleRelativeSec()));
                        } else if (res.limitation() != null) {
                            limitationSet.add(res.limitation());
                        }
                    }
                }
                case DamageEvent d -> {
                    // 仅用于「首次接敌」判定（存在性，不涉伤害值）；掉血量走 hpLoss
                    final boolean recorderIsAttacker = d.attackerEid() == recorderEid;
                    final boolean recorderIsVictim = d.victimEid() == recorderEid;
                    if ((recorderIsAttacker || recorderIsVictim) && res.isUsable()
                            && firstContactTime < 0) {
                        firstContactTime = res.battleRelativeSec();
                    }
                }
                case com.wotb.core.replay.event.BattleEndedEvent b -> {
                    if (Float.isNaN(battleEndClock)) {
                        if (res.isUsable()) {
                            battleEndClock = res.battleRelativeSec();
                        } else if (res.limitation() != null) {
                            limitationSet.add(res.limitation());
                        }
                    }
                }
                default -> {}
            }
        }

        // Battle-end resolution via shared resolver
        final Float eventBasedEnd = Float.isFinite(battleEndClock) ? battleEndClock : null;
        final float lastEvidenceMax = (float) DoubleStream.concat(
                        positions.stream().mapToDouble(t -> (double) t.battleRelativeSec()),
                        damages.stream().mapToDouble(t -> (double) t.battleRelativeSec()))
                .max()
                .orElse(Float.NaN);
        final Float localEnd = Float.isFinite(lastEvidenceMax) && lastEvidenceMax >= 0f ? lastEvidenceMax : null;
        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, eventBasedEnd, localEnd);
        final float phaseEndClock = result.resolved() ? result.battleEndRelativeSec() : Float.NaN;
        if (result.limitation() != null) {
            limitationSet.add(result.limitation());
        }

        // 压缩移动段（只针对 recorder，使用 battle-relative 时间）
        final List<MovementSegment> movements = compressMovements(
                positions, battle == null ? null : battle.mapName);

        // 交火段
        final List<EngagementSummary> engagements = buildEngagements(damages, recorderAccount);

        // Phases (battle-relative) + 双方存活人数（battle_results deathTimeMillis，缺失时事件流估算）
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhasesWithSurvival(
                        firstContactTime, phaseEndClock,
                        BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle, recorder.team()));

        // 关键事件
        final List<KeyBattleEvent> keyEvents = extractRecorderKeyEvents(damages, recorderAccount);

        final boolean hasRealFeatures = !movements.isEmpty()
                || !engagements.isEmpty()
                || !keyEvents.isEmpty();
        final List<String> limitations = new ArrayList<>(limitationSet);
        if (battleStartRes.limitation() != null) {
            limitations.add(battleStartRes.limitation());
        }
        // 事件流观测子集与权威结算一致时才不算 PARTIAL；覆盖未达 100% 时标记，
        // 触发 prompt 层抑制观测数字，强制以权威结算为唯一可信口径。
        final var recorderResult = battle != null ? battle.recorderResult() : null;
        final int observedDealt = engagements.stream()
                .mapToInt(EngagementSummary::damageDealt)
                .sum();
        final int observedReceived = engagements.stream()
                .mapToInt(EngagementSummary::damageReceived)
                .sum();
        final boolean observedMatchesAuthoritative = recorderResult != null
                && ObservedDamageCoverage.matches(
                        observedDealt, observedReceived,
                        recorderResult.damageDealt, recorderResult.damageReceived);
        if (!observedMatchesAuthoritative) {
            limitations.add("OBSERVED_DAMAGE_IS_PARTIAL");
        }
        if (!hasRealFeatures) {
            limitations.add("Recorder entity has no position or damage events in event stream");
        }
        if (recorder.confidence() != DecodeConfidence.EXACT) {
            limitations.add("Recorder entity mapping confidence: " + recorder.confidence()
                    + " — entity ID may be unreliable");
        }

        return new PlayerBattleFeatureSet(movements, engagements, phases, keyEvents,
                limitations, hasRealFeatures);
    }

    static List<MovementSegment> compressMovements(final List<TimedPosition> positions,
                                                   final String mapCode) {
        // Keep only positions with a resolvable canonical coordinate.
        // INVALID positions (non-finite / beyond clamp tolerance) are unusable movement
        // evidence and must not create fake distance/speed.
        final List<TimedPosition> usable = positions.stream()
                .filter(tp -> MapRegionResolver.resolve(tp.event().x(), tp.event().z(), mapCode).usable())
                .toList();
        if (usable.isEmpty()) return List.of();
        if (usable.size() == 1) {
            final TimedPosition only = usable.get(0);
            final float t = only.battleRelativeSec();
            final Vector3 pos = new Vector3(only.event().x(), only.event().y(), only.event().z());
            return List.of(new MovementSegment(t, t,
                    MovementType.STATIONARY, pos, pos,
                    0f, 0f, positionConfidence(usable.subList(0, 1))));
        }

        final List<MovementSegment> result = new ArrayList<>();
        int start = 0;
        for (int i = 1; i < usable.size(); i++) {
            // Distance in canonical meters (each endpoint resolved/clamped to canonical first).
            final float totalDist = MapRegionResolver.canonicalDistanceMeters(
                    usable.get(start).event().x(), usable.get(start).event().z(),
                    usable.get(i).event().x(), usable.get(i).event().z(), mapCode);
            final float segmentTime = usable.get(i).battleRelativeSec()
                    - usable.get(start).battleRelativeSec();

            // Non-positive / reversed / zero time delta must not produce Infinity/NaN speed.
            if (segmentTime <= 0.1f) continue;

            final boolean stationary = totalDist < STATIONARY_THRESHOLD_METERS;
            if (i < usable.size() - 1) {
                // 检查下一段是否同类型（canonical meters）
                final float nextDist = MapRegionResolver.canonicalDistanceMeters(
                        usable.get(i).event().x(), usable.get(i).event().z(),
                        usable.get(i + 1).event().x(), usable.get(i + 1).event().z(), mapCode);
                final boolean nextStationary = nextDist < STATIONARY_THRESHOLD_METERS;
                if (stationary == nextStationary && i - start > 1) continue;
            }

            result.add(new MovementSegment(
                    usable.get(start).battleRelativeSec(),
                    usable.get(i).battleRelativeSec(),
                    stationary ? MovementType.STATIONARY : MovementType.MOVING,
                    new Vector3(usable.get(start).event().x(), usable.get(start).event().y(), usable.get(start).event().z()),
                    new Vector3(usable.get(i).event().x(), usable.get(i).event().y(), usable.get(i).event().z()),
                    totalDist, totalDist / segmentTime,
                    positionConfidence(usable.subList(start, i + 1))));
            start = i;
        }
        return result;
    }

    private static DecodeConfidence positionConfidence(
            final List<TimedPosition> positions
    ) {
        return positions.stream()
                .map(TimedPosition::event)
                .map(PositionChangedEvent::confidence)
                .map(confidence -> confidence == null
                        ? DecodeConfidence.UNKNOWN : confidence)
                .min(Comparator.comparingInt(
                        DefaultPlayerBattleFeatureExtractor::confidenceRank))
                .orElse(DecodeConfidence.UNKNOWN);
    }

    private static int confidenceRank(final DecodeConfidence confidence) {
        return switch (confidence) {
            case UNKNOWN -> 0;
            case PARTIAL -> 1;
            case INFERRED -> 2;
            case EXACT -> 3;
        };
    }

    static List<EngagementSummary> buildEngagements(final List<TimedHpLoss> damages, final Long recorderAccount) {
        if (damages.isEmpty()) return List.of();
        final List<TimedHpLoss> sorted = damages.stream()
                .sorted(Comparator.comparingDouble(d -> d.battleRelativeSec()))
                .toList();
        final List<EngagementSummary> result = new ArrayList<>();
        int segStart = 0;
        for (int i = 1; i < sorted.size(); i++) {
            if (sorted.get(i).battleRelativeSec() - sorted.get(i - 1).battleRelativeSec() > ENGAGEMENT_GAP_SEC) {
                result.add(buildEngagementSegment(sorted.subList(segStart, i), recorderAccount));
                segStart = i;
            }
        }
        if (segStart < sorted.size()) {
            result.add(buildEngagementSegment(sorted.subList(segStart, sorted.size()), recorderAccount));
        }
        return result;
    }

    /** §13：dealt 只计有支持证据的掉血（attackerReliable 已在收集时保证）；received 为该车全部掉血。 */
    private static EngagementSummary buildEngagementSegment(final List<TimedHpLoss> events, final Long recorderAccount) {
        int dealt = 0, received = 0;
        for (final TimedHpLoss d : events) {
            if (d.attackerAccountId() == recorderAccount) dealt += d.loss().hpLoss();
            if (d.victimAccountId() == recorderAccount) received += d.loss().hpLoss();
        }
        return new EngagementSummary(
                events.getFirst().battleRelativeSec(),
                events.getLast().battleRelativeSec(),
                List.of(), List.of(), dealt, received,
                null, null, com.wotb.core.replay.event.DecodeConfidence.INFERRED);
    }

    static List<KeyBattleEvent> extractRecorderKeyEvents(
            final List<TimedHpLoss> damages, final Long recorderAccount) {
        final List<KeyBattleEvent> keyEvents = new ArrayList<>();
        boolean firstBlood = false;
        int totalEvents = 0;

        for (final TimedHpLoss d : damages) {
            if (!firstBlood) {
                firstBlood = true;
                keyEvents.add(new KeyBattleEvent(d.battleRelativeSec(), "RECORDER_FIRST_BLOOD",
                        "首次命中 " + d.loss().hpLoss()));
            } else {
                keyEvents.add(new KeyBattleEvent(d.battleRelativeSec(),
                        d.attackerAccountId() != 0 && d.attackerAccountId() == recorderAccount
                                ? "RECORDER_DAMAGE_DEALT" : "RECORDER_DAMAGE_RECEIVED",
                        "录像者 " + d.loss().hpLoss()));
            }
            totalEvents++;
        }
        return keyEvents;
    }

    record TimedPosition(PositionChangedEvent event, float battleRelativeSec) {}

    /** recorder 相关的权威掉血记录（§12/§13；attackerAccountId=0 表示不可归属——不参与 dealt）。 */
    private record TimedHpLoss(
            PlaybackCombatReconstruction.Loss loss,
            long attackerAccountId,
            long victimAccountId,
            float battleRelativeSec) {}

}