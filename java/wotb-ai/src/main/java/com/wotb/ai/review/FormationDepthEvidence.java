package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class FormationDepthEvidence {

    static final double FIRE_DISTANCE_NORM_M = FormationDepthPhaseRenderer.FIRE_DISTANCE_NORM_M;

    private FormationDepthEvidence() {
    }

    record PhaseRange(String key, double start, double end) {
    }

    record PositionSample(int entityId, double t, double x, double z) {
    }

    static String renderSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final String mapCode
    ) {
        if (battle == null || recon == null || recon.events() == null || battle.players == null) {
            return "";
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        if (mapping.entitiesById().isEmpty()) {
            return "";
        }
        final Float battleStart = recon.battleStartRawClockSec();
        final Map<Long, PlayerResult> playersByAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p != null) {
                    playersByAccount.put(p.accountId, p);
                }
            }
        }

        final Map<Long, List<PositionSample>> tracks = new LinkedHashMap<>();
        final Map<Long, Integer> teamByAccount = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof PositionChangedEvent pos)) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(pos.entityId());
            if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                continue;
            }
            if (!playersByAccount.containsKey(identity.accountId())) {
                continue;
            }
            if (!Float.isFinite(pos.x()) || !Float.isFinite(pos.z())) {
                continue;
            }
            final double t = relativeSec(event, battleStart);
            if (!Double.isFinite(t) || t < 0) {
                continue;
            }
            final PlayerResult player = playersByAccount.get(identity.accountId());
            final Double deathSec = player == null ? null : knownDeathSec(battle, player);
            if (deathSec != null && t > deathSec + 1e-6) {
                continue;
            }
            tracks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                    .add(new PositionSample(pos.entityId(), t, pos.x(), pos.z()));
            teamByAccount.putIfAbsent(identity.accountId(), identity.team());
        }
        if (tracks.isEmpty()) {
            return "";
        }
        final double battleEnd = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : lastSampleTime(tracks);
        if (battleEnd <= 0) {
            return "";
        }
        final Map<Long, TankTacticalProfile> accountProfiles = new LinkedHashMap<>();
        if (battle.players != null) {
            final TankTacticalProfileRegistry registry = profileRegistry();
            for (final PlayerResult p : battle.players) {
                if (p == null) {
                    continue;
                }
                accountProfiles.put(p.accountId, registry.profileFor(p.tankId, p.tankName,
                        ReplayDisplayNames.tankClass(p.tankId), ReplayDisplayNames.tankTier(p.tankId)));
            }
        }

        final List<PhaseRange> phases = buildPhases(firstDamageTime(recon.events(), battleStart), battleEnd);

        final Map<Integer, List<AoiObservationSegment>> aoiByEntity =
                ReplayAoiLifecycle.indexByEntity(ReplayAoiLifecycle.build(
                        recon.events(), battleStart == null ? null : battleStart.doubleValue()));

        final StringBuilder sb = new StringBuilder();
        for (final PhaseRange phase : phases) {
            sb.append(renderPhase(battle, phase, tracks, teamByAccount, perspectiveTeam, mapCode,
                    playersByAccount, accountProfiles, mapping, aoiByEntity));
        }
        return sb.isEmpty() ? "" : "\n=== FORMATION_DEPTH（阵型深度·确定性） ===\n" + sb;
    }

    private static String renderPhase(
            final Battle battle,
            final PhaseRange phase,
            final Map<Long, List<PositionSample>> tracks,
            final Map<Long, Integer> teamByAccount,
            final int perspectiveTeam,
            final String mapCode,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity
    ) {
        final Map<Long, PhasePositionReference> refsByAccount = new LinkedHashMap<>();
        for (final Map.Entry<Long, List<PositionSample>> entry : tracks.entrySet()) {
            final int team = teamByAccount.getOrDefault(entry.getKey(), 0);
            final PhasePositionReference ref = resolvePhasePosition(
                    battle, entry.getKey(), team, entry.getValue(),
                    phase.start(), phase.end(), playersByAccount,
                    mapping, aoiByEntity, perspectiveTeam);
            if (ref != null) {
                refsByAccount.put(entry.getKey(), ref);
            }
        }
        final int ownTeam = perspectiveTeam;
        final int enemyTeam = 3 - ownTeam;
        final Map<Long, PhasePositionReference> ownCurrent = new LinkedHashMap<>();
        final Map<Long, PhasePositionReference> enemyCurrent = new LinkedHashMap<>();
        final Map<Long, PhasePositionReference> enemyLastKnown = new LinkedHashMap<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : refsByAccount.entrySet()) {
            final PhasePositionReference ref = entry.getValue();
            if (!ref.current()) {
                if (ref.team() == enemyTeam) {
                    enemyLastKnown.put(entry.getKey(), ref);
                }
                continue;
            }
            if (ref.team() == ownTeam) {
                ownCurrent.put(entry.getKey(), ref);
            } else {
                enemyCurrent.put(entry.getKey(), ref);
            }
        }
        int ownRefCount = 0;
        int enemyRefCount = 0;
        int ownAliveCount = 0;
        int enemyAliveCount = 0;
        for (final Map.Entry<Long, PlayerResult> entry : playersByAccount.entrySet()) {
            final PlayerResult pl = entry.getValue();
            if (pl == null || (pl.team != ownTeam && pl.team != enemyTeam)) {
                continue;
            }
            if (!isAliveAt(battle, playersByAccount, entry.getKey(), phase.end())) {
                continue;
            }
            final boolean hasCurrent = pl.team == ownTeam
                    ? ownCurrent.containsKey(entry.getKey())
                    : enemyCurrent.containsKey(entry.getKey());
            if (pl.team == ownTeam) {
                ownAliveCount++;
                if (hasCurrent) {
                    ownRefCount++;
                }
            } else {
                enemyAliveCount++;
                if (hasCurrent) {
                    enemyRefCount++;
                }
            }
        }

        return FormationDepthPhaseRenderer.renderPhase(
                phase.key(), phase.start(), phase.end(),
                renderReferences(ownCurrent), renderReferences(enemyCurrent), renderReferences(enemyLastKnown),
                profiles, mapCode, ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount);
    }

    private static Map<Long, FormationDepthPhaseRenderer.PositionReference> renderReferences(
            final Map<Long, PhasePositionReference> references) {
        final Map<Long, FormationDepthPhaseRenderer.PositionReference> result = new LinkedHashMap<>();
        for (final Map.Entry<Long, PhasePositionReference> entry : references.entrySet()) {
            final PhasePositionReference ref = entry.getValue();
            result.put(entry.getKey(), new FormationDepthPhaseRenderer.PositionReference(
                    ref.x(), ref.z(), ref.observedAtSec(), ref.ageSec()));
        }
        return result;
    }

    record PhasePositionReference(
            long accountId,
            int team,
            double x,
            double z,
            PositionKnowledge knowledge,
            double observedAtSec,
            double ageSec
    ) {
        boolean current() {
            return knowledge == PositionKnowledge.CURRENT;
        }
    }

    static PhasePositionReference resolvePhasePosition(
            final long accountId,
            final int team,
            final List<PositionSample> samples,
            final double phaseStart,
            final double phaseEnd,
            final Map<Long, PlayerResult> playersByAccount,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final int perspectiveTeam) {
        return resolvePhasePosition(null, accountId, team, samples, phaseStart, phaseEnd,
                playersByAccount, mapping, aoiByEntity, perspectiveTeam);
    }

    static PhasePositionReference resolvePhasePosition(
            final Battle battle,
            final long accountId,
            final int team,
            final List<PositionSample> samples,
            final double phaseStart,
            final double phaseEnd,
            final Map<Long, PlayerResult> playersByAccount,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final int perspectiveTeam) {
        final FormationDepthPositionResolver.PhasePositionReference resolved =
                FormationDepthPositionResolver.resolvePhasePosition(
                        isAliveAt(battle, playersByAccount, accountId, phaseEnd),
                        accountId, team, toResolverSamples(samples), phaseStart, phaseEnd,
                        mapping, aoiByEntity);
        return resolved == null ? null : new PhasePositionReference(
                resolved.accountId(), resolved.team(), resolved.x(), resolved.z(),
                resolved.knowledge(), resolved.observedAtSec(), resolved.ageSec());
    }

    private static List<FormationDepthPositionResolver.PositionSample> toResolverSamples(
            final List<PositionSample> samples) {
        if (samples == null || samples.isEmpty()) {
            return List.of();
        }
        final List<FormationDepthPositionResolver.PositionSample> converted = new ArrayList<>();
        for (final PositionSample sample : samples) {
            converted.add(new FormationDepthPositionResolver.PositionSample(
                    sample.entityId(), sample.t(), sample.x(), sample.z()));
        }
        return converted;
    }

    static double[] carriedForwardReference(final List<PositionSample> samples, final double phaseEnd) {
        return FormationDepthPositionResolver.carriedForwardReference(toResolverSamples(samples), phaseEnd);
    }


    private static volatile TankTacticalProfileRegistry profileRegistryInstance;

    static TankTacticalProfileRegistry profileRegistry() {
        TankTacticalProfileRegistry local = profileRegistryInstance;
        if (local == null) {
            synchronized (FormationDepthEvidence.class) {
                local = profileRegistryInstance;
                if (local == null) {
                    local = TankTacticalProfileRegistry.load();
                    profileRegistryInstance = local;
                }

            }
        }
        return local;
    }

    static Double knownDeathSec(final Battle battle, final PlayerResult p) {
        if (p == null || p.survived) {
            return null;
        }
        final double sec = PlayerResultFormat.deathSec(p);
        return sec > 0 ? sec : null;
    }

    static boolean isAliveAt(final Battle battle, final Map<Long, PlayerResult> playersByAccount,
                             final long accountId, final double t) {
        final PlayerResult p = playersByAccount == null ? null : playersByAccount.get(accountId);
        if (p == null) {
            return true;
        }
        final Double deathSec = knownDeathSec(battle, p);
        return deathSec == null || t <= deathSec + 1e-6;
    }



    static List<PhaseRange> buildPhases(final double firstContact, final double battleEnd) {
        final List<PhaseRange> phases = new ArrayList<>();
        final double openingEnd = firstContact >= 0
                ? Math.min(battleEnd, firstContact + 15.0) : battleEnd;
        final double lateStart = Math.max(openingEnd, battleEnd - 15.0);
        phases.add(new PhaseRange("opening", 0.0, openingEnd));
        if (lateStart > openingEnd + 1e-3) {
            phases.add(new PhaseRange("mid", openingEnd, lateStart));
        }
        if (battleEnd - lateStart > 1e-3) {
            phases.add(new PhaseRange("late", lateStart, battleEnd));
        }
        return phases;
    }

    static double firstDamageTime(final List<ReplayEvent> events, final Float battleStart) {
        double first = -1;
        if (events == null) {
            return first;
        }
        for (final ReplayEvent event : events) {
            if (!(event instanceof DamageEvent damage)) {
                continue;
            }
            final double t = relativeSec(damage, battleStart);
            if (Double.isFinite(t) && t >= 0 && (first < 0 || t < first)) {
                first = t;
            }
        }
        return first;
    }

    static double lastSampleTime(final Map<Long, List<PositionSample>> tracks) {
        double last = 0;
        for (final List<PositionSample> list : tracks.values()) {
            for (final PositionSample s : list) {
                last = Math.max(last, s.t());
            }
        }
        return last;
    }

    static double[] centroid(final List<double[]> points) {
        return FormationDepthMath.centroid(points);
    }

    static double relativeSec(final ReplayEvent event, final Float battleStartRawClockSec) {
        if (event.timestamp() == null) {
            return 0;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)) {
            return event.timestamp().rawClockSec() - battleStartRawClockSec;
        }
        return event.timestamp().rawClockSec();
    }

    static String fmt(final double sec) {
        return FormationDepthMath.fmt(sec);
    }
}
