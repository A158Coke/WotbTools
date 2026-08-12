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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamSoloIntentSkillTest {

    @Test
    void openingSpreadLabelsMapControlNotDetach() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final TeamBattleFeatureSet features = features(
                List.of(member(0, 0, true, null, List.of(), List.of(), 1)),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("OPENING_MAP_CONTROL", evidence.getFirst().labels().get("intent"));
    }

    @Test
    void stationaryHoldWithTeammateRotationLabelsDelay() {
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 200, true, null,
                List.of(stationary(60, 240, 100, 150)),
                List.of(engagement(120, 180, 10_001L, List.of(20_001L, 20_002L), 200)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
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
        final Battle battle = battle(3, new double[]{0, 0, 90, 0, 0, 0, 0}, new long[7]);
        final TeamMemberFeatureSet solo = member(0, 1800, false, 90.0,
                List.of(move(45, 90, 0, 0, -150, -100, 5f)), List.of(), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
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
        final Battle battle = battle(2, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 400, true, null,
                List.of(stationary(115, 260, 150, 100)),
                List.of(engagement(130, 200, 10_001L, List.of(20_002L), 300)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(120, 135, 400, 350, 400, 350, 260, 260, 260, 260, "account:10001"),
                new TeamAggregateResult(7, 3500, 2600, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(), "contradictory signals must not produce a hard candidate");
    }

    @Test
    void fiveTwoSplitMainClusterMembersProduceNoCandidate() {
        // 5+2 分簇：主力 5 人（P0-P4）+ 独立 2 人（P5-P6）。主力成员 P0 静止+接火+主力转场：
        // 旧实现会反向把 P0 判成单走拖延；新实现只输出 P6。
        final Battle battle = battle(3, new double[7], new long[7]);
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 0, true, null,
                    List.of(stationary(60, 90, 0, 0)),
                    index == 0 || index == 6
                            ? List.of(engagement(60, 75, 10_001L + index,
                            List.of(20_001L, 20_002L), 200))
                            : List.of(),
                    1));
        }
        final List<TeamFormationPhase> phases = List.of(
                twoClusterPhase(60, 75, 250, 250, 400, 400, 0, 4, 5, 6),
                twoClusterPhase(75, 90, 300, 250, 400, 400, 0, 4, 5, 6));
        final TeamBattleFeatureSet features = features(
                members, phases,
                new TeamAggregateResult(7, 4000, 2000, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size(), "only the off-main member must be a candidate");
        assertEquals("SOLO_DELAY", evidence.getFirst().labels().get("intent"));
        assertTrue(evidence.getFirst().summary().contains("P6"),
                "candidate must belong to the small-cluster member");
        assertFalse(evidence.getFirst().summary().contains("P0"),
                "main-cluster member must never be flagged as solo");
    }

    @Test
    void teamTwoPerspectiveIgnoresTeamOneCapturePoints() {
        // Team 2 视角：Team 1 的整场占点分不是 Team 2 的队友获利证据。
        final Battle battle = battle(3, new double[7], new long[]{0, 0, 0, 0, 0, 0, 999});
        final TeamMemberFeatureSet solo = member(0, 200, true, null,
                List.of(stationary(120, 135, 150, 100)),
                List.of(engagement(120, 135, 10_001L, List.of(20_001L), 200)), 2);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 2)),
                phases(120, 135, 400, 350, 400, 350, 260, 260, 260, 260, "account:10001"),
                new TeamAggregateResult(7, 1000, 500, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                2);

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "team 1 capture points must not count as team 2 teammate benefit");
    }

    @Test
    void missingBattlePhasesDoesNotTreatWholeBattleAsOpening() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final TeamBattleFeatureSet features = features(
                List.of(member(0, 0, true, null, List.of(), List.of(), 1)),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true),
                List.of());

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "without battle phases no OPENING_MAP_CONTROL may be emitted");
    }

    @Test
    void noDistanceGrowthSuppressesDetach() {
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(move(60, 75, 0, 0, 50, 0, 2f)),
                List.of(engagement(60, 75, 10_001L, List.of(20_001L, 20_002L, 20_003L), 1800)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 75, 150, 180, 150, 180, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(), "single-window span has no growth evidence -> no SOLO_DETACHED");
    }

    @Test
    void lateDeathOutsideSpanDoesNotWhiteEaten() {
        final Battle battle = battle(3, new double[]{0, 0, 0, 0, 0, 0, 200}, new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, false, 200.0,
                List.of(move(60, 90, 0, 0, -150, -100, 2f)),
                List.of(), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 90, 150, 180, 100, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 1000, 0, 0, 0, 6, 1, 200.0, 200.0, 200.0, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "death outside the span must not white-eat the window");
    }

    @Test
    void mainClusterTieIsAmbiguousAndProducesNothing() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 0, true, null, List.of(), List.of(), 1));
        }
        // 3+3+1：两个 3 人簇平票，无法确定主力 → 不硬判
        final TeamFormationPhase phase = new TeamFormationPhase(
                60, 75, new CanonicalMapPosition(250, 250), 80f, 7,
                DecodeConfidence.EXACT, List.of(
                        cluster(60, 75, 250, 250, List.of(key(0), key(1), key(2))),
                        cluster(60, 75, 400, 400, List.of(key(3), key(4), key(5))),
                        cluster(60, 75, 100, 100, List.of(key(6)))));
        final TeamBattleFeatureSet features = features(
                members, List.of(phase),
                new TeamAggregateResult(7, 1000, 500, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        assertNull(TeamSoloIntentSkill.mainClusterOf(phase));
        assertTrue(TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN).isEmpty());
    }

    @Test
    void engagementSpanningFourWindowsCountedOnce() {
        // 同一交火段横跨 4 个 15s formation window：实际承伤 300、1 名敌人，按 span 去重后
        // 不得被累计成承伤 1200 / 敌情 4，因此不得误生成 SOLO_DETACHED
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(move(60, 120, 100, 150, 0, 150, 2f)),
                List.of(engagement(60, 120, 10_001L, List.of(20_001L), 300)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 120, 100, 150, 0, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "one engagement across 4 windows must be counted once: received=300 enemies=1 -> no SOLO_DETACHED");
    }

    @Test
    void partialObservationDoesNotDeclareMainCluster() {
        // 7 名成员存活但只观测到 4 人（3+1 子集）：不得把子集最大簇称为全局主力
        final Battle battle = battle(1, new double[7], new long[7]);
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 0, true, null, List.of(), List.of(), 1));
        }
        final TeamFormationPhase phase = new TeamFormationPhase(
                60, 75, new CanonicalMapPosition(250, 250), 80f, 4,
                DecodeConfidence.EXACT, List.of(
                        cluster(60, 75, 250, 250, List.of(key(0), key(1), key(2))),
                        cluster(60, 75, 400, 400, List.of(key(6)))));

        assertNull(TeamSoloIntentSkill.mainClusterOf(phase, 7),
                "observed subset must not be declared global main cluster");
        final TeamBattleFeatureSet features = features(
                members, List.of(phase),
                new TeamAggregateResult(7, 1000, 500, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        assertTrue(TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN).isEmpty());
    }

    @Test
    void soloWindowsWithMissingPhaseAreNotMerged() {
        // [60,75] 与 [90,105] 中间缺失 75-90 phase：禁止跨缺口合并 span，距离增长不得跨缺口计算
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(move(60, 75, 100, 150, 100, 150, 2f),
                        move(90, 105, 0, 150, 0, 150, 2f)),
                List.of(engagement(60, 105, 10_001L,
                        List.of(20_001L, 20_002L, 20_003L), 1800)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                List.of(
                        twoClusterPhase(60, 75, 300, 250, 100, 150, 1, 6, 0, 0),
                        twoClusterPhase(90, 105, 300, 250, 0, 150, 1, 6, 0, 0)),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "solo windows separated by a missing 15s phase must not merge across the gap");
    }

    @Test
    void thinMovementCoverageIsUnknown() {
        // 30s span 只有 1s 移动覆盖（60-61s）：覆盖/窗口时长 < 门控 → UNKNOWN，不得按 MOVING 判脱节
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(move(60, 61, 100, 150, 100, 150, 5f)),
                List.of(engagement(60, 90, 10_001L,
                        List.of(20_001L, 20_002L, 20_003L), 1800)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 90, 100, 150, 0, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(), "1s movement coverage in a 30s span must not imply MOVING");
    }

    @Test
    void authoritativeDamageOutsideSpanDoesNotWhiteEaten() {
        // 整场权威承伤（member.damageReceived=1800）没有对应窗口内交火：不得冒充窗口内被白吃
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 1800, true, null,
                List.of(move(60, 90, 0, 0, -150, -100, 2f)),
                List.of(), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 90, 150, 180, 100, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "whole-battle authoritative damageReceived must not white-eat the window without in-window evidence");
    }

    // ===== helpers =====

    private static TeamFormationPhase twoClusterPhase(
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

    private static TeamBattleFeatureSet features(
            final List<TeamMemberFeatureSet> members,
            final List<TeamFormationPhase> formationPhases,
            final TeamAggregateResult aggregate,
            final List<BattlePhaseSummary> battlePhases) {
        return features(members, formationPhases, aggregate, battlePhases, 1);
    }

    private static TeamBattleFeatureSet features(
            final List<TeamMemberFeatureSet> members,
            final List<TeamFormationPhase> formationPhases,
            final TeamAggregateResult aggregate,
            final List<BattlePhaseSummary> battlePhases,
            final int perspectiveTeam) {
        return new TeamBattleFeatureSet(
                perspectiveTeam, members, aggregate, TeamObservedAggregate.empty(),
                formationPhases, List.of(), battlePhases, List.of(),
                TeamFeatureCoverage.empty(), List.of(), true);
    }

    private static TeamMemberFeatureSet member(
            final int index, final int damageReceived, final boolean survived,
            final Double deathSec, final List<MovementSegment> movements,
            final List<EngagementSummary> engagements, final int team) {
        final long accountId = 10_001L + index;
        return new TeamMemberFeatureSet(
                List.of((int) accountId), accountId, "P" + index, 4481L, "Kranvagn", team,
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

    private static TeamFormationCluster cluster(final float start, final float end,
                                                final float x, final float z,
                                                final List<String> identities) {
        final CanonicalMapPosition centroid = new CanonicalMapPosition(x, z);
        return new TeamFormationCluster(start, end, centroid, MapCoordinateResolution.Status.VALID,
                centroid.region(), 0, identities, DecodeConfidence.EXACT);
    }

    private static String key(final int index) {
        return "account:" + (10_001L + index);
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
                                                final long ally, final List<Long> enemies,
                                                final int damageReceived) {
        return new EngagementSummary(start, end, List.of(ally), enemies,
                300, damageReceived, new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                EngagementOutcome.UNFAVORABLE, DecodeConfidence.PARTIAL);
    }

    private static Battle battle(final int arenaBonusType, final double[] deathSecs,
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
            player.victoryPointsEarned = (int) earned[index];
            battle.players.add(player);
        }
        return battle;
    }
}
