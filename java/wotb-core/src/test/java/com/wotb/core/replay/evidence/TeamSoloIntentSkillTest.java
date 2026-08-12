package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.EngagementOutcome;
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
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamSoloIntentSkillTest {

    @Test
    void openingSpreadLabelsMapControlNotDetach() {
        final Battle battle = battle(1, new double[7]);
        final TeamBattleFeatureSet features = features(
                List.of(member(0, 0, true, null, List.of(), List.of())),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("OPENING_MAP_CONTROL", evidence.getFirst().labels().get("intent"));
    }

    @Test
    void stationaryHoldWithTeammateBenefitLabelsDelay() {
        final Battle battle = battle(3, new double[7]);
        final TeamMemberFeatureSet solo = member(0, 400, true, null,
                List.of(stationary(60, 240, 100, 150)),
                List.of(engagement(120, 180, 10_001L, List.of(20_001L, 20_002L))));
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 200, true, null, List.of(), List.of())),
                phases(60, 240, 350, 400, 350, 400, 300, 250, 400, 250, "account:10001"),
                new TeamAggregateResult(7, 5200, 1500, 0, 0, 1, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("SOLO_DELAY", evidence.getFirst().labels().get("intent"));
        assertTrue(evidence.getFirst().numbers().get("teammateBenefit") > 0);
    }

    @Test
    void movingPushWithoutBenefitLabelsDetach() {
        final Battle battle = battle(3, new double[]{0, 0, 90, 0, 0, 0, 0});
        final TeamMemberFeatureSet solo = member(0, 1800, false, 90.0,
                List.of(move(45, 90, 0, 0, -150, -100, 5f)), List.of());
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 300, true, null, List.of(), List.of())),
                phases(60, 90, 150, 180, 100, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3200, 3200, 0, 0, 0, 6, 1, 90.0, 90.0, 90.0, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("SOLO_DETACHED", evidence.getFirst().labels().get("intent"));
    }

    @Test
    void contradictorySignalsProduceNoCandidate() {
        final Battle battle = battle(2, new double[7]);
        final TeamMemberFeatureSet solo = member(0, 400, true, null,
                List.of(stationary(115, 260, 150, 100)),
                List.of(engagement(130, 200, 10_001L, List.of(20_002L))));
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 300, true, null, List.of(), List.of())),
                phases(120, 135, 400, 350, 400, 350, 260, 260, 260, 260, "account:10001"),
                new TeamAggregateResult(7, 3500, 2600, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(), "contradictory signals must not produce a hard candidate");
    }

    // ===== helpers =====

    private static TeamBattleFeatureSet features(
            final List<TeamMemberFeatureSet> members,
            final List<TeamFormationPhase> formationPhases,
            final TeamAggregateResult aggregate,
            final List<BattlePhaseSummary> battlePhases) {
        return new TeamBattleFeatureSet(
                1, members, aggregate, TeamObservedAggregate.empty(),
                formationPhases, List.of(), battlePhases, List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
    }

    private static TeamMemberFeatureSet member(
            final int index, final int damageReceived, final boolean survived,
            final Double deathSec, final List<MovementSegment> movements,
            final List<EngagementSummary> engagements) {
        final long accountId = 10_001L + index;
        return new TeamMemberFeatureSet(
                List.of((int) accountId), accountId, "P" + index, 4481L, "Kranvagn", 1,
                DecodeConfidence.EXACT, 900, damageReceived, 0, 0, 0,
                survived, deathSec, null, movements, engagements, List.of(), List.of());
    }

    private static List<TeamFormationPhase> phases(
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
        int step = 0;
        while (t < end) {
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
            step++;
            if (step > 100) {
                break;
            }
        }
        return phases;
    }

    private static TeamFormationCluster cluster(final float start, final float end,
                                                final float x, final float z,
                                                final List<String> identities) {
        final CanonicalMapPosition centroid = new CanonicalMapPosition(x, z);
        return new TeamFormationCluster(start, end, centroid, MapCoordinateResolution.Status.VALID,
                centroid.region(), 0, identities, DecodeConfidence.EXACT);
    }

    private static float lerp(final float from, final float to, final float progress) {
        return from + (to - from) * progress;
    }

    private static MovementSegment stationary(final float start, final float end,
                                              final float x, final float z) {
        return new MovementSegment(start, end, MovementType.STATIONARY,
                new Vector3(x, 0f, z), new Vector3(x, 0f, z), 0f, 0f, DecodeConfidence.EXACT);
    }

    private static MovementSegment move(final float start, final float end,
                                        final float x1, final float z1,
                                        final float x2, final float z2, final float speed) {
        final float distance = (float) Math.hypot(x2 - x1, z2 - z1);
        return new MovementSegment(start, end, MovementType.MOVING,
                new Vector3(x1, 0f, z1), new Vector3(x2, 0f, z2),
                distance, speed, DecodeConfidence.EXACT);
    }

    private static EngagementSummary engagement(final float start, final float end,
                                                final long ally, final List<Long> enemies) {
        return new EngagementSummary(start, end, List.of(ally), enemies,
                300, 200, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                EngagementOutcome.UNFAVORABLE, DecodeConfidence.PARTIAL);
    }

    private static Battle battle(final int arenaBonusType, final double[] deathSecs) {
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
            player.team = 1;
            player.tankId = 4481L;
            player.survived = deathSecs[index] <= 0;
            player.deathTimeMillis = deathSecs[index] > 0
                    ? (long) (deathSecs[index] * 1000) : 0L;
            battle.players.add(player);
        }
        return battle;
    }
}
