package com.wotb.ai.review.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.processing.BattleCategory;
import com.wotb.core.replay.processing.BattleCategoryUtils;
import com.wotb.core.replay.reconstruction.Vector3;
import java.util.ArrayList;
import java.util.List;

final class AiEvalTeamFixtureSupport {
    private AiEvalTeamFixtureSupport() {
    }

    private static final String[] FRIENDLY_NAMES = {"H1", "H2", "M1", "M2", "M3", "T1", "L1"};
    private static final long[] FRIENDLY_TANKS = {4481L, 10785L, 14609L, 12305L, 14609L, 9489L, 4413L};

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


    static List<TeamMemberFeatureSet> compactTeam() {
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 300, true, null, null,
                    List.of(stationary(60, 260, 0, 0)), List.of(), List.of()));
        }
        return members;
    }

    static TeamMemberFeatureSet teammateAdvancing(final int index) {
        return member(index, 200, true, null, null,
                List.of(move(60, 150, 0, 0, 50, 0, 1f), move(150, 240, 50, 0, 150, 0, 1.5f)),
                List.of(), List.of());
    }

    static TeamMemberFeatureSet cappingTeammate(final int index) {
        return member(index, 300, true, null, null,
                List.of(move(200, 260, 50, 0, 0, -100, 1.5f)), List.of(), List.of());
    }

    record Earned(long accountId, int victoryPointsEarned) {
    }

    static Earned earned(final long accountId, final int points) {
        return new Earned(accountId, points);
    }

    static Earned enemyEarned(final long accountId, final int points) {
        return new Earned(accountId, points);
    }

    static Battle battle(final int arenaBonusType, final Integer winnerTeam,
                                 final double[] deathSecs, final Earned[] points) {
        return battle(arenaBonusType, winnerTeam, deathSecs, points, null);
    }

    static Battle battle(final int arenaBonusType, final Integer winnerTeam,
                                 final double[] deathSecs, final Earned[] points,
                                 final double[] enemyDeathSecs) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = arenaBonusType;
        battle.durationS = 300.0;
        battle.winnerTeam = winnerTeam;
        battle.rosterComplete = true;
        battle.recorder = FRIENDLY_NAMES[0];
        battle.players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            final PlayerResult player = player(
                    10_001L + index, FRIENDLY_NAMES[index], "CHRD", 1,
                    FRIENDLY_TANKS[index], 900, deathSecs[index]);
            player.victoryPointsEarned = pointsFor(points, player.accountId);
            battle.players.add(player);
        }
        for (int index = 0; index < 7; index++) {
            final PlayerResult player = player(
                    20_001L + index, "E" + (index + 1), "NOVA", 2,
                    FRIENDLY_TANKS[index], 800,
                    enemyDeathSecs != null && enemyDeathSecs.length > index
                            ? enemyDeathSecs[index] : 0.0);
            player.victoryPointsEarned = pointsFor(points, player.accountId);
            battle.players.add(player);
        }
        return battle;
    }

    static int pointsFor(final Earned[] points, final long accountId) {
        if (points == null) {
            return 0;
        }
        for (final Earned earned : points) {
            if (earned.accountId() == accountId) {
                return earned.victoryPointsEarned();
            }
        }
        return 0;
    }

    static PlayerResult player(
            final long accountId,
            final String nickname,
            final String clan,
            final int team,
            final long tankId,
            final int damage,
            final double deathSec
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.clan = clan;
        player.team = team;
        player.tankId = tankId;
        player.tankName = resolveTankName(tankId);
        player.damageDealt = damage;
        player.survived = deathSec <= 0;
        player.deathTimeMillis = deathSec > 0 ? (long) (deathSec * 1000) : 0L;
        player.settlementLifeTimeSec = deathSec;
        return player;
    }

    static String resolveTankName(final long tankId) {
        final String name = ReplayDisplayNames.tankName(tankId, "");
        return name.isBlank() ? "T" + tankId : name;
    }

    static TeamMemberFeatureSet member(
            final int index,
            final int damageReceived,
            final boolean survived,
            final Double deathSec,
            final TeamMemberFeatureSet.DeathProximity deathProximity,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<String> limitations
    ) {
        final long accountId = 10_001L + index;
        final long tankId = FRIENDLY_TANKS[index];
        return new TeamMemberFeatureSet(
                List.of((int) accountId), accountId, FRIENDLY_NAMES[index],
                tankId, resolveTankName(tankId), 1,
                DecodeConfidence.EXACT, 900, damageReceived, 0, 0, 0,
                survived, deathSec, deathProximity, movements, engagements,
                List.of(), limitations);
    }

    static TeamMemberFeatureSet.DeathProximity deathProximity(
            final double meters, final double deltaSec) {
        return new TeamMemberFeatureSet.DeathProximity(meters, deltaSec, DecodeConfidence.INFERRED);
    }

    static String key(final int index) {
        return "account:" + (10_001L + index);
    }

    static List<String> mainKeys() {
        return List.of(key(0), key(1), key(2), key(3), key(4), key(5), key(6));
    }

    static List<String> mainKeysExcluding(final int soloIndex) {
        final List<String> keys = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            if (index != soloIndex) {
                keys.add(key(index));
            }
        }
        return keys;
    }

    static MovementSegment move(
            final float start, final float end,
            final float x1, final float z1, final float x2, final float z2,
            final float speed) {
        final float distance = (float) Math.hypot(x2 - x1, z2 - z1);
        return new MovementSegment(start, end, MovementType.MOVING,
                new Vector3(x1, 0f, z1), new Vector3(x2, 0f, z2),
                distance, speed, DecodeConfidence.EXACT);
    }

    static MovementSegment stationary(
            final float start, final float end, final float x, final float z) {
        return new MovementSegment(start, end, MovementType.STATIONARY,
                new Vector3(x, 0f, z), new Vector3(x, 0f, z),
                0f, 0f, DecodeConfidence.EXACT);
    }

    static List<TeamFormationPhase> soloPhases(
            final float start, final float end,
            final float soloX1, final float soloZ1, final float soloX2, final float soloZ2,
            final float mainX1, final float mainZ1, final float mainX2, final float mainZ2,
            final String soloIdentity, final List<String> mainIdentities) {
        final List<TeamFormationPhase> phases = new ArrayList<>();
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

    static TeamFormationPhase phase(
            final float start, final float end,
            final float centroidX, final float centroidZ,
            final float dispersion, final int observed,
            final List<TeamFormationCluster> clusters) {
        return new TeamFormationPhase(start, end,
                new CanonicalMapPosition(centroidX, centroidZ),
                dispersion, observed, DecodeConfidence.EXACT, clusters);
    }

    static TeamFormationCluster cluster(
            final float start, final float end,
            final float centroidX, final float centroidZ,
            final List<String> memberIdentities) {
        final CanonicalMapPosition centroid = new CanonicalMapPosition(centroidX, centroidZ);
        return new TeamFormationCluster(start, end, centroid,
                MapCoordinateResolution.Status.VALID, centroid.region(), 0,
                memberIdentities, DecodeConfidence.EXACT);
    }

    static EngagementSummary engagement(
            final float start, final float end,
            final long allyAccountId, final List<Long> enemyAccountIds) {
        return new EngagementSummary(start, end, List.of(allyAccountId), enemyAccountIds,
                300, 200, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                DecodeConfidence.PARTIAL);
    }

    static EngagementSummary engagement(
            final float start, final float end,
            final long allyAccountId, final List<Long> enemyAccountIds,
            final int damageReceived) {
        return new EngagementSummary(start, end, List.of(allyAccountId), enemyAccountIds,
                300, damageReceived, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                DecodeConfidence.PARTIAL);
    }

    static EngagementSummary favorableEngagement(final float start, final float end,
                                                         final long allyAccountId) {
        return new EngagementSummary(start, end, List.of(allyAccountId), List.of(20_001L),
                300, 50, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                DecodeConfidence.PARTIAL);
    }

    static KeyBattleEvent keyEvent(final float clock, final String type, final String label) {
        return new KeyBattleEvent(clock, type, label, DecodeConfidence.EXACT, "TEST", List.of());
    }

    static float lerp(final float from, final float to, final float progress) {
        return from + (to - from) * progress;
    }

    static SingleTeamBattleAnalysisContext context(
            final String key,
            final int arenaBonusType,
            final Integer winnerTeam,
            final double[] deathSecs,
            final List<TeamMemberFeatureSet> members,
            final TeamAggregateResult aggregate,
            final List<TeamFormationPhase> phases,
            final List<BattlePhaseSummary> battlePhases,
            final List<KeyBattleEvent> keyEvents,
            final List<String> limitations,
            final Earned... points
    ) {
        return context(key, arenaBonusType, winnerTeam, deathSecs, members, aggregate, phases,
                battlePhases, keyEvents, limitations, null, points);
    }

    static SingleTeamBattleAnalysisContext context(
            final String key,
            final int arenaBonusType,
            final Integer winnerTeam,
            final double[] deathSecs,
            final List<TeamMemberFeatureSet> members,
            final TeamAggregateResult aggregate,
            final List<TeamFormationPhase> phases,
            final List<BattlePhaseSummary> battlePhases,
            final List<KeyBattleEvent> keyEvents,
            final List<String> limitations,
            final double[] enemyDeathSecs,
            final Earned... points
    ) {
        final Battle battle = battle(arenaBonusType, winnerTeam, deathSecs, points, enemyDeathSecs);
        final TeamBattleFeatureSet features = new TeamBattleFeatureSet(
                1, members, aggregate, TeamObservedAggregate.empty(),
                phases, List.of(), battlePhases, keyEvents,
                TeamFeatureCoverage.empty(), limitations, true);
        final BattleCategory category = BattleCategoryUtils.fromArenaBonusType(arenaBonusType);
        return new SingleTeamBattleAnalysisContext(
                "eval-" + key, null, key + ".wotbreplay", category, battle, 1, features,
                null, limitations, null);
    }
}
