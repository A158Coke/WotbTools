package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.facts.HpObservation;
import com.wotb.core.replay.facts.HpObservationKind;
import com.wotb.core.replay.facts.ReplayHpTimeline;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ObservedMaxHp {

    private ObservedMaxHp() {
    }

    public static Map<Long, Integer> byAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        if (events == null) {
            return new HashMap<>();
        }
        return observedByAccount(ReplayHpTimeline.build(events, mapping, null));
    }

    private static Map<Long, Integer> observedByAccount(final List<HpObservation> observations) {
        final Map<Long, Integer> observed = new HashMap<>();
        for (final HpObservation hp : observations) {
            if (!hp.plausible()) {
                continue;
            }
            observed.merge(hp.accountId(), hp.hp(), Math::max);
        }
        return observed;
    }

    public static void populate(
            final Battle battle,
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        if (battle == null || battle.players == null || events == null || mapping == null) {
            return;
        }
        final List<HpObservation> observations = ReplayHpTimeline.build(events, mapping, null);
        final Map<Long, Integer> observed = observedByAccount(observations);
        final Map<Long, List<HpObservation>> hpTimeline =
                hpTimelineByAccount(observations);
        final Map<Long, Double> firstDamageSec = firstDamageSecByAccount(events, mapping);
        final Map<Long, Integer> observedReceived = observedReceivedByAccount(events, mapping);
        final Long recorderAccountId = PlayerResultFormat.recorderAccountId(battle);
        for (final PlayerResult player : battle.players) {
            if (player == null) {
                continue;
            }
            player.observedMaxHp = resolve(observed.get(player.accountId), player.tankId);
            final boolean coverageExact = receivedCoverageExact(player, observedReceived.get(player.accountId));
            resolveEntryHp(player, hpTimeline.get(player.accountId),
                    firstDamageSec.get(player.accountId), coverageExact,
                    recorderAccountId != null && recorderAccountId == player.accountId);
        }
    }

    public static Integer fullMaxHp(final PlayerResult p) {
        if (p.entryHpSource == EntryHpSource.OBSERVED_EXACT
                && p.entryHp != null && p.entryHp > 0) {
            return p.entryHp;
        }
        return ReplayDisplayNames.tankMaxHpValue(p.tankId);
    }

    private static boolean receivedCoverageExact(final PlayerResult p, final Integer observedReceived) {
        final int authoritative = p.damageReceived;
        if (authoritative <= 0) {
            return observedReceived == null || observedReceived == 0;
        }
        return observedReceived != null && observedReceived == authoritative;
    }

    public static Integer resolve(final Integer observed, final long tankId) {
        final Integer base = ReplayDisplayNames.tankMaxHpValue(tankId);
        if (observed == null) {
            return base;
        }
        if (base == null) {
            return observed;
        }
        return Math.max(observed, base);
    }

    private static void resolveEntryHp(final PlayerResult player,
                                       final List<HpObservation> samples,
                                       final Double firstDamageSec,
                                       final boolean coverageExact,
                                       final boolean recorder) {
        final Integer base = ReplayDisplayNames.tankMaxHpValue(player.tankId);
        player.entryHpSource = null;
        player.entryHp = null;
        if (samples == null || samples.isEmpty()) {
            player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
            return;
        }
        if (recorder) {
            final HpObservation opening = samples.stream()
                    .filter(HpObservation::plausible)
                    .filter(s -> s.kind() == HpObservationKind.RECORDER_HP_MIRROR
                            || s.kind() == HpObservationKind.MATERIALIZATION_HP)
                    .filter(s -> beforeFirstDamage(s.timeSec(), firstDamageSec))
                    .min(java.util.Comparator.comparingDouble(HpObservation::timeSec))
                    .orElse(null);
            if (opening != null) {
                player.entryHpSource = EntryHpSource.OBSERVED_EXACT;
                player.entryHp = opening.hp();
                return;
            }
        }
        if (!coverageExact) {
            player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
            return;
        }
        final HpObservation firstPlausible = samples.stream()
                .filter(HpObservation::plausible)
                .min(java.util.Comparator.comparingDouble(HpObservation::timeSec))
                .orElse(null);
        if (firstPlausible == null) {
            player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
            return;
        }
        final double firstSampleTime = firstPlausible.timeSec();
        final int firstSampleHp = firstPlausible.hp();
        if (beforeFirstDamage(firstSampleTime, firstDamageSec) && base != null
                && firstSampleHp >= base) {
            player.entryHpSource = EntryHpSource.OBSERVED_EXACT;
            player.entryHp = firstSampleHp;
            return;
        }
        player.entryHpSource = base != null ? EntryHpSource.BASE_FALLBACK : EntryHpSource.UNKNOWN;
    }

    private static boolean beforeFirstDamage(final double sampleTime, final Double firstDamageSec) {
        return firstDamageSec == null || sampleTime < firstDamageSec - 1e-6;
    }

    private static Map<Long, Integer> observedReceivedByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, Integer> out = new HashMap<>();
        if (events == null || mapping == null) {
            return out;
        }
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        events, mapping, 0.0, Double.MAX_VALUE);
        for (final java.util.Map.Entry<Long,
                List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> entry
                : combat.lossesByVictim().entrySet()) {
            int total = 0;
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l
                    : entry.getValue()) {
                total += l.hpLoss();
            }
            out.put(entry.getKey(), total);
        }
        return out;
    }

    private static Map<Long, List<HpObservation>> hpTimelineByAccount(
            final List<HpObservation> observations
    ) {
        final Map<Long, List<HpObservation>> out = new HashMap<>();
        for (final HpObservation hp : observations) {
            if (hp.accountId() <= 0) {
                continue;
            }
            out.computeIfAbsent(hp.accountId(), k -> new ArrayList<>()).add(hp);
        }
        out.values().forEach(list -> list.sort(
                java.util.Comparator.comparingDouble(HpObservation::timeSec)));
        return out;
    }

    private static Map<Long, Double> firstDamageSecByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, Double> out = new HashMap<>();
        if (events == null || mapping == null) {
            return out;
        }
        for (final ReplayEvent event : events) {
            final int victimEid;
            if (event instanceof VehicleHitEvent hit && hit.confidence() == DecodeConfidence.EXACT) {
                victimEid = hit.victimEntityId();
            } else if (event instanceof DamageEvent damage && damage.damage() > 0) {
                victimEid = damage.victimEid();
            } else {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(victimEid);
            if (identity == null || identity.accountId() <= 0) {
                continue;
            }
            final double t = relativeSec(event);
            out.merge(identity.accountId(), t, Math::min);
        }
        return out;
    }

    private static double relativeSec(final ReplayEvent e) {
        if (e.timestamp() == null) {
            return 0;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        return e.timestamp().rawClockSec();
    }
}
