package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class RelativeDepthHpEvidence {

    private RelativeDepthHpEvidence() {
    }

    static final double HP_ADVANTAGE_RATIO = RelativeDepthHpPhaseRenderer.HP_ADVANTAGE_RATIO;
    static final int ATTACKER_DAMAGE_MIN = 1;
    static final double DIST_BAND_M = 50.0;
    static final double DIST_BAND_FAR_M = 150.0;
    static final double HP_BAND_1 = 1.5;
    static final double HP_BAND_2 = 2.0;

    static String renderTeamSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final boolean observedDamagePartial
    ) {
        return render(battle, recon, perspectiveTeam, null, observedDamagePartial);
    }

    static String renderPlayerSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final long recorderAccountId,
            final boolean observedDamagePartial
    ) {
        return render(battle, recon, null, recorderAccountId, observedDamagePartial);
    }

    private static String render(
            final Battle battle,
            final ReplayReconstruction recon,
            final Integer perspectiveTeam,
            final Long selfAccountId,
            final boolean observedDamagePartial
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
        final Map<Long, TankTacticalProfile> profiles = new LinkedHashMap<>();
        final TankTacticalProfileRegistry registry = FormationDepthEvidence.profileRegistry();
        for (final PlayerResult p : battle.players) {
            if (p == null) {
                continue;
            }
            profiles.put(p.accountId, registry.profileFor(p.tankId, p.tankName,
                    ReplayDisplayNames.tankClass(p.tankId), ReplayDisplayNames.tankTier(p.tankId)));
        }


        final Map<Long, List<FormationDepthEvidence.PositionSample>> tracks = new LinkedHashMap<>();
        final Map<Long, List<double[]>> hpSamples = new LinkedHashMap<>();
        final Map<Long, List<Double>> attacks = new LinkedHashMap<>();
        final Map<Long, Integer> teamByAccount = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (event instanceof PositionChangedEvent pos) {
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
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                final Double deathSec = FormationDepthEvidence.knownDeathSec(battle,
                        playersByAccount.get(identity.accountId()));
                if (deathSec != null && t > deathSec + 1e-6) {
                    continue;
                }
                tracks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                        .add(new FormationDepthEvidence.PositionSample(pos.entityId(), t, pos.x(), pos.z()));
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            } else if (event instanceof HealthChangedEvent hp) {
                final TeamEntityIdentity identity = mapping.identity(hp.entityId());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                if (hp.currentHealth() == null || (hp.currentHealth() != 0
                        && !HealthChangedEvent.isPlausibleHp(hp.currentHealth()))) {
                    continue;
                }
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                hpSamples.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                        .add(new double[]{t, hp.currentHealth()});
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            } else if (event instanceof DamageEvent dmg) {
                final TeamEntityIdentity identity = mapping.identity(dmg.attackerEid());
                if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                    continue;
                }
                final double t = FormationDepthEvidence.relativeSec(event, battleStart);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                final Double deathSec = FormationDepthEvidence.knownDeathSec(battle,
                        playersByAccount.get(identity.accountId()));
                if (deathSec != null && t > deathSec + 1e-6) {
                    continue;
                }
                attacks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>()).add(t);
                teamByAccount.putIfAbsent(identity.accountId(), identity.team());
            }
        }
        if (tracks.isEmpty()) {
            return "";
        }
        final double battleEnd = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : FormationDepthEvidence.lastSampleTime(tracks);
        if (battleEnd <= 0) {
            return "";
        }
        final List<FormationDepthEvidence.PhaseRange> phases = FormationDepthEvidence.buildPhases(
                FormationDepthEvidence.firstDamageTime(recon.events(), battleStart), battleEnd);
        final List<Long> targets = new ArrayList<>();
        if (selfAccountId != null) {
            if (teamByAccount.getOrDefault(selfAccountId, 0) <= 0) {
                return "";
            }
            targets.add(selfAccountId);
        } else {
            for (final Map.Entry<Long, Integer> entry : teamByAccount.entrySet()) {
                if (Objects.equals(entry.getValue(), perspectiveTeam)) {
                    targets.add(entry.getKey());
                }
            }
        }
        if (targets.isEmpty()) {
            return "";
        }
        final Map<Integer, List<com.wotb.core.replay.facts.AoiObservationSegment>> aoiByEntity =
                com.wotb.core.replay.facts.ReplayAoiLifecycle.indexByEntity(
                        com.wotb.core.replay.facts.ReplayAoiLifecycle.build(
                                recon.events(), battleStart == null ? null : battleStart.doubleValue()));
        return RelativeDepthHpPhaseRenderer.render(
                battle, phases, tracks, hpSamples, attacks, teamByAccount, playersByAccount,
                profiles, targets, selfAccountId, observedDamagePartial, mapping, aoiByEntity);
    }
}
