package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.facts.ShotFact;
import com.wotb.core.replay.facts.ShotLifecycle;
import com.wotb.core.replay.facts.TargetingDerivedFacts;
import com.wotb.core.replay.facts.TargetingShotPair;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.DoubleStream;

/** 默认录像者个人特征提取器。 */
public class DefaultPlayerBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 15;
    static final float STATIONARY_THRESHOLD_METERS = 3f;

    public PlayerBattleFeatureSet extract(
            final ReplayReconstruction reconstruction,
            final RecorderEntityMapping recorder,
            final Battle battle) {
        if (recorder == null || !recorder.resolved() || reconstruction == null) {
            return PlayerBattleFeatureSet.empty();
        }

        final int recorderEid = recorder.entityId();
        final List<ReplayEvent> events = reconstruction.events();
        final BattleStartResolution battleStartRes = BattleStartResolver.resolve(
                reconstruction.battleStartRawClockSec(),
                reconstruction.events(), battle);

        final List<TimedPosition> positions = new ArrayList<>();
        final List<TimedHpLoss> damages = new ArrayList<>();
        final LinkedHashSet<String> limitationSet = new LinkedHashSet<>();
        float firstContactTime = -1f;
        float battleEndClock = Float.NaN;

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, reconstruction);
        final Float battleStartRaw = reconstruction.battleStartRawClockSec();
        final double duration = reconstruction.battleDurationSec() > 0
                ? reconstruction.battleDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        final PlaybackCombatReconstruction.Result combat = PlaybackCombatReconstruction.derive(
                events, mapping,
                battleStartRaw == null ? 0.0 : battleStartRaw.doubleValue(), duration);
        final Long recorderAccount = recorder.accountId();
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
                    final boolean recorderIsAttacker = d.attackerEid() == recorderEid;
                    final boolean recorderIsVictim = d.victimEid() == recorderEid;
                    if ((recorderIsAttacker || recorderIsVictim) && res.isUsable()
                            && firstContactTime < 0) {
                        firstContactTime = res.battleRelativeSec();
                    }
                }
                case VehicleHitEvent h -> {
                    // PR147 §33: method8 is a hit/result-feedback family — a proven hit still marks first
                    // contact (attacker/victim engagement); no damage magnitude is used.
                    final boolean recorderIsAttacker = h.attackerEntityId() == recorderEid;
                    final boolean recorderIsVictim = h.victimEntityId() == recorderEid;
                    if ((recorderIsAttacker || recorderIsVictim) && res.isUsable()
                            && firstContactTime < 0) {
                        firstContactTime = res.battleRelativeSec();
                    }
                }
                case com.wotb.core.replay.event.RoundFinishedEvent ignored -> {
                    if (Float.isNaN(battleEndClock)) {
                        if (res.isUsable()) {
                            battleEndClock = res.battleRelativeSec();
                        } else if (res.limitation() != null) {
                            limitationSet.add(res.limitation());
                        }
                    }
                }
                default -> { }
            }
        }

        final Float eventBasedEnd = Float.isFinite(battleEndClock) ? battleEndClock : null;
        final float lastEvidenceMax = (float) DoubleStream.concat(
                        positions.stream().mapToDouble(t -> (double) t.battleRelativeSec()),
                        damages.stream().mapToDouble(t -> (double) t.battleRelativeSec()))
                .max().orElse(Float.NaN);
        final Float localEnd = Float.isFinite(lastEvidenceMax) && lastEvidenceMax >= 0f
                ? lastEvidenceMax : null;
        final BattleEndResolver.BattleEndResult result =
                BattleEndResolver.resolve(battle, eventBasedEnd, localEnd);
        final float phaseEndClock = result.resolved() ? result.battleEndRelativeSec() : Float.NaN;
        if (result.limitation() != null) {
            limitationSet.add(result.limitation());
        }

        // One AoI authority: derive hard observation boundaries from ReplayAoiLifecycle, never from time-gap guessing.
        final double startRawForAoi = battleStartRaw == null
                ? Double.NaN : battleStartRaw.doubleValue();
        final List<Double> recorderAoiLeaves = ReplayAoiLifecycle.build(events, startRawForAoi).stream()
                .filter(segment -> segment.entityId() == recorderEid && segment.absentFromSec() != null)
                .map(segment -> segment.absentFromSec())
                .sorted()
                .toList();
        final List<MovementSegment> movements = compressMovements(
                positions, battle == null ? null : battle.mapName, recorderAoiLeaves);

        final List<EngagementSummary> engagements = buildEngagements(damages, recorderAccount);
        final List<BattlePhaseSummary> phases = BattlePhaseSummary.buildRelativePhasesWithSurvival(
                firstContactTime, phaseEndClock,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle, recorder.team()));
        final List<KeyBattleEvent> keyEvents = extractRecorderKeyEvents(damages, recorderAccount);

        final boolean hasRealFeatures = !movements.isEmpty()
                || !engagements.isEmpty() || !keyEvents.isEmpty();
        final List<String> limitations = new ArrayList<>(limitationSet);
        if (battleStartRes.limitation() != null) {
            limitations.add(battleStartRes.limitation());
        }
        final var recorderResult = battle != null ? battle.recorderResult() : null;
        final int observedDealt = engagements.stream().mapToInt(EngagementSummary::damageDealt).sum();
        final int observedReceived = engagements.stream().mapToInt(EngagementSummary::damageReceived).sum();
        final boolean observedMatchesAuthoritative = recorderResult != null
                && ObservedDamageCoverage.matches(observedDealt, observedReceived,
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

        final double startRaw = battleStartRaw == null ? 0.0 : battleStartRaw.doubleValue();
        final List<ShotFact> shots = ShotLifecycle.build(
                events, mapping, PlayerResultFormat.recorderAccountId(battle), startRaw);
        final List<TargetingShotPair> targetingPairs = TargetingDerivedFacts.pair(
                shots, events, startRaw);
        return new PlayerBattleFeatureSet(movements, engagements, phases, keyEvents,
                shots, targetingPairs, limitations, hasRealFeatures);
    }

    static List<MovementSegment> compressMovements(final List<TimedPosition> positions,
                                                    final String mapCode) {
        return compressMovements(positions, mapCode, List.of());
    }

    static List<MovementSegment> compressMovements(
            final List<TimedPosition> positions,
            final String mapCode,
            final List<Double> leaveTimes) {
        final List<TimedPosition> usable = positions.stream()
                .filter(tp -> MapRegionResolver.resolve(tp.event().x(), tp.event().z(), mapCode).usable())
                .sorted(Comparator.comparingDouble(TimedPosition::battleRelativeSec))
                .toList();
        if (usable.isEmpty()) return List.of();
        final List<Double> sortedLeaves = leaveTimes == null ? List.of()
                : leaveTimes.stream().filter(Double::isFinite).sorted().toList();
        final List<List<TimedPosition>> groups = new ArrayList<>();
        List<TimedPosition> current = new ArrayList<>();
        int prevLeaveIdx = 0;
        for (final TimedPosition p : usable) {
            int leaveIdx = 0;
            while (leaveIdx < sortedLeaves.size()
                    && sortedLeaves.get(leaveIdx) < p.battleRelativeSec() - 1e-9) {
                leaveIdx++;
            }
            if (!current.isEmpty() && leaveIdx != prevLeaveIdx) {
                groups.add(current);
                current = new ArrayList<>();
            }
            current.add(p);
            prevLeaveIdx = leaveIdx;
        }
        if (!current.isEmpty()) {
            groups.add(current);
        }
        final List<MovementSegment> result = new ArrayList<>();
        for (final List<TimedPosition> group : groups) {
            result.addAll(compressGroup(group, mapCode));
        }
        return result;
    }

    private static List<MovementSegment> compressGroup(
            final List<TimedPosition> usable, final String mapCode) {
        if (usable.isEmpty()) {
            return List.of();
        }
        if (usable.size() == 1) {
            final TimedPosition only = usable.getFirst();
            final float t = only.battleRelativeSec();
            final Vector3 pos = new Vector3(only.event().x(), only.event().y(), only.event().z());
            return List.of(MovementSegment.derived(t, t,
                    MovementType.STATIONARY, pos, pos,
                    0f, 0f, positionConfidence(usable.subList(0, 1)),
                    only.event().yaw(), only.event().yaw()));
        }

        final List<MovementSegment> result = new ArrayList<>();
        int start = 0;
        for (int i = 1; i < usable.size(); i++) {
            final float totalDist = MapRegionResolver.canonicalDistanceMeters(
                    usable.get(start).event().x(), usable.get(start).event().z(),
                    usable.get(i).event().x(), usable.get(i).event().z(), mapCode);
            final float segmentTime = usable.get(i).battleRelativeSec()
                    - usable.get(start).battleRelativeSec();
            if (segmentTime <= 0.1f) continue;

            final boolean stationary = totalDist < STATIONARY_THRESHOLD_METERS;
            if (i < usable.size() - 1) {
                final float nextDist = MapRegionResolver.canonicalDistanceMeters(
                        usable.get(i).event().x(), usable.get(i).event().z(),
                        usable.get(i + 1).event().x(), usable.get(i + 1).event().z(), mapCode);
                final boolean nextStationary = nextDist < STATIONARY_THRESHOLD_METERS;
                if (stationary == nextStationary && i - start > 1) continue;
            }

            result.add(MovementSegment.derived(
                    usable.get(start).battleRelativeSec(),
                    usable.get(i).battleRelativeSec(),
                    stationary ? MovementType.STATIONARY : MovementType.MOVING,
                    new Vector3(usable.get(start).event().x(), usable.get(start).event().y(), usable.get(start).event().z()),
                    new Vector3(usable.get(i).event().x(), usable.get(i).event().y(), usable.get(i).event().z()),
                    totalDist, totalDist / segmentTime,
                    positionConfidence(usable.subList(start, i + 1)),
                    usable.get(start).event().yaw(), usable.get(i).event().yaw()));
            start = i;
        }
        return result;
    }

    private static DecodeConfidence positionConfidence(final List<TimedPosition> positions) {
        return positions.stream()
                .map(TimedPosition::event)
                .map(PositionChangedEvent::confidence)
                .map(confidence -> confidence == null ? DecodeConfidence.UNKNOWN : confidence)
                .min(Comparator.comparingInt(DefaultPlayerBattleFeatureExtractor::confidenceRank))
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

    static List<EngagementSummary> buildEngagements(
            final List<TimedHpLoss> damages, final Long recorderAccount) {
        if (damages.isEmpty()) return List.of();
        final List<TimedHpLoss> sorted = damages.stream()
                .sorted(Comparator.comparingDouble(TimedHpLoss::battleRelativeSec))
                .toList();
        final List<EngagementSummary> result = new ArrayList<>();
        int segStart = 0;
        for (int i = 1; i < sorted.size(); i++) {
            if (sorted.get(i).battleRelativeSec() - sorted.get(i - 1).battleRelativeSec()
                    > ENGAGEMENT_GAP_SEC) {
                result.add(buildEngagementSegment(sorted.subList(segStart, i), recorderAccount));
                segStart = i;
            }
        }
        if (segStart < sorted.size()) {
            result.add(buildEngagementSegment(sorted.subList(segStart, sorted.size()), recorderAccount));
        }
        return result;
    }

    private static EngagementSummary buildEngagementSegment(
            final List<TimedHpLoss> events, final Long recorderAccount) {
        int dealt = 0;
        int received = 0;
        for (final TimedHpLoss d : events) {
            if (d.attackerAccountId() == recorderAccount) dealt += d.loss().hpLoss();
            if (d.victimAccountId() == recorderAccount) received += d.loss().hpLoss();
        }
        return new EngagementSummary(
                events.getFirst().battleRelativeSec(),
                events.getLast().battleRelativeSec(),
                List.of(), List.of(), dealt, received,
                null, null, DecodeConfidence.INFERRED);
    }

    static List<KeyBattleEvent> extractRecorderKeyEvents(
            final List<TimedHpLoss> damages, final Long recorderAccount) {
        final List<KeyBattleEvent> keyEvents = new ArrayList<>();
        boolean firstBlood = false;
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
        }
        return keyEvents;
    }

    record TimedPosition(PositionChangedEvent event, float battleRelativeSec) { }

    private record TimedHpLoss(
            PlaybackCombatReconstruction.Loss loss,
            long attackerAccountId,
            long victimAccountId,
            float battleRelativeSec) { }
}
