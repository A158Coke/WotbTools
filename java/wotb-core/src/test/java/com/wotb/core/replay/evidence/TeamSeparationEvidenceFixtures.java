package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.Vector3;
import java.util.ArrayList;
import java.util.List;

final class TeamSeparationEvidenceFixtures {
    private TeamSeparationEvidenceFixtures() { }

    // ===== helpers（与原测试一致） =====

    static TeamFormationPhase twoClusterPhase(
            final float start, final float end,
            final float mainX, final float mainZ,
            final float smallX, final float smallZ,
            final int mainFrom, final int mainTo,
            final int smallFrom, final int smallTo) {
        final List<String> main = new ArrayList<>();
        for (int index = mainFrom; index <= mainTo; index++) {
            main.add(key(index));
        }
        final List<String> small = new ArrayList<>();
        for (int index = smallFrom; index <= smallTo; index++) {
            small.add(key(index));
        }
        return new TeamFormationPhase(
                start, end, new CanonicalMapPosition(mainX, mainZ), 80f, 7,
                DecodeConfidence.EXACT, List.of(
                        cluster(start, end, mainX, mainZ, main),
                        cluster(start, end, smallX, smallZ, small)));
    }

    static TeamBattleFeatureSet features(
            final List<TeamMemberFeatureSet> members,
            final List<TeamFormationPhase> formationPhases,
            final TeamAggregateResult aggregate,
            final List<BattlePhaseSummary> battlePhases) {
        return features(members, formationPhases, aggregate, battlePhases, 1);
    }

    static TeamBattleFeatureSet features(
            final List<TeamMemberFeatureSet> members,
            final List<TeamFormationPhase> formationPhases,
            final TeamAggregateResult aggregate,
            final List<BattlePhaseSummary> battlePhases,
            final int perspectiveTeam) {
        return features(members, formationPhases, aggregate, battlePhases, perspectiveTeam, List.of());
    }

    static TeamBattleFeatureSet features(
            final List<TeamMemberFeatureSet> members,
            final List<TeamFormationPhase> formationPhases,
            final TeamAggregateResult aggregate,
            final List<BattlePhaseSummary> battlePhases,
            final int perspectiveTeam,
            final List<String> limitations) {
        return new TeamBattleFeatureSet(
                perspectiveTeam, members, aggregate, TeamObservedAggregate.empty(),
                formationPhases, List.of(), battlePhases, List.of(),
                TeamFeatureCoverage.empty(), limitations, true);
    }

    static TeamMemberFeatureSet member(
            final int index, final int damageReceived, final boolean survived,
            final Double deathSec, final List<MovementSegment> movements,
            final List<EngagementSummary> engagements, final int team) {
        final long accountId = 10_001L + index;
        return new TeamMemberFeatureSet(
                List.of((int) accountId), accountId, "P" + index, 4481L, "Kranvagn", team,
                DecodeConfidence.EXACT, 900, damageReceived, 0, 0, 0,
                survived, deathSec, null, movements, engagements, List.of(), List.of());
    }

    static List<TeamFormationPhase> phases(
            final float start, final float end,
            final float soloX1, final float soloZ1,
            final float soloX2, final float soloZ2,
            final float mainX1, final float mainZ1,
            final float mainX2, final float mainZ2,
            final String soloIdentity) {
        final List<TeamFormationPhase> phases = new ArrayList<>();
        final List<String> mainIdentities = List.of(
                "account:10002", "account:10003", "account:10004",
                "account:10005", "account:10006", "account:10007");
        float t = start;
        int guard = 0;
        while (t < end && guard < 100) {
            final float windowEnd = Math.min(t + 15f, end);
            final float progress = (windowEnd - start) / Math.max(1f, end - start);
            final float soloX = lerp(soloX1, soloX2, progress);
            final float soloZ = lerp(soloZ1, soloZ2, progress);
            final float mainX = lerp(mainX1, mainX2, progress);
            final float mainZ = lerp(mainZ1, mainZ2, progress);
            phases.add(new TeamFormationPhase(
                    t, windowEnd, new CanonicalMapPosition(mainX, mainZ), 90f, 7,
                    DecodeConfidence.EXACT, List.of(
                            cluster(t, windowEnd, soloX, soloZ, List.of(soloIdentity)),
                            cluster(t, windowEnd, mainX, mainZ, mainIdentities))));
            t = windowEnd;
            guard++;
        }
        return phases;
    }

    static TeamFormationCluster cluster(final float start, final float end,
                                                final float x, final float z,
                                                final List<String> identities) {
        final CanonicalMapPosition centroid = new CanonicalMapPosition(x, z);
        return new TeamFormationCluster(start, end, centroid, MapCoordinateResolution.Status.VALID,
                centroid.region(), 0, identities, DecodeConfidence.EXACT);
    }

    static String key(final int index) {
        return "account:" + (10_001L + index);
    }

    static float lerp(final float from, final float to, final float progress) {
        return from + (to - from) * progress;
    }

    static MovementSegment stationary(final float start, final float end,
                                              final float x, final float z) {
        return new MovementSegment(start, end, MovementType.STATIONARY,
                new Vector3(x, 0f, z), new Vector3(x, 0f, z), 0f, 0f, DecodeConfidence.EXACT);
    }

    static MovementSegment move(final float start, final float end,
                                        final float x1, final float z1,
                                        final float x2, final float z2, final float speed) {
        final float distance = (float) Math.hypot(x2 - x1, z2 - z1);
        return new MovementSegment(start, end, MovementType.MOVING,
                new Vector3(x1, 0f, z1), new Vector3(x2, 0f, z2),
                distance, speed, DecodeConfidence.EXACT);
    }

    static EngagementSummary engagement(final float start, final float end,
                                                final long ally, final List<Long> enemies,
                                                final int damageReceived) {
        return new EngagementSummary(start, end, List.of(ally), enemies,
                300, damageReceived, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                DecodeConfidence.PARTIAL);
    }

    static Battle battle(final int arenaBonusType, final double[] deathSecs,
                                 final long[] earned) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = arenaBonusType;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = "P0";
        battle.players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            final PlayerResult player = new PlayerResult();
            player.accountId = 10_001L + index;
            player.nickname = "P" + index;
            player.team = index < 4 ? 1 : 2;
            player.tankId = 4481L;
            player.survived = deathSecs[index] <= 0;
            player.deathTimeMillis = deathSecs[index] > 0
                    ? (long) (deathSecs[index] * 1000) : 0L;
            player.settlementLifeTimeSec = deathSecs[index];
            player.victoryPointsEarned = (int) earned[index];
            battle.players.add(player);
        }
        return battle;
    }
}
