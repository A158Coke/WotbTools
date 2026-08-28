package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.DeathTimeSource;
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
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * TeamSeparationEvidenceSkill — Backend Evidence Boundary 回归测试。
 * <p>只输出中性空间分离结构事实（kind=OPENING_SPREAD / SEPARATION_WINDOW + 确定性测量），
 * 不输出 SOLO_DELAY / SOLO_DETACHED / teammateBenefit / 队友获利 / 卡点 / 守点等战术 verdict。</p>
 */
class TeamSeparationEvidenceSkillTest {

    @Test
    void openingSpreadIsNeutralSpatialStructure() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final TeamBattleFeatureSet features = features(
                List.of(member(0, 0, true, null, List.of(), List.of(), 1)),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals(EvidenceType.SPATIAL_SEPARATION, evidence.getFirst().type());
        assertEquals("OPENING_SPREAD", evidence.getFirst().labels().get("kind"));
        // summary 只描述空间结构，不得声称地图信息收益/拿视野/图控
        assertTrue(evidence.getFirst().summary().contains("空间分离")
                || evidence.getFirst().summary().contains("开局分散"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("拿视野"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("图控"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("侦察收益"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("拖延"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("脱节"), evidence.getFirst().summary());
    }

    @Test
    void stationaryHoldEmitsNeutralSeparationWindowNotDelay() {
        // 旧逻辑会输出 SOLO_DELAY（静止+压力+队友获利）；现在只输出中性 SEPARATION_WINDOW 事实
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 200, true, null,
                List.of(stationary(60, 240, 100, 150)),
                List.of(engagement(120, 180, 10_001L, List.of(20_001L, 20_002L), 200)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 240, 350, 400, 350, 400, 300, 250, 400, 250, "account:10001"),
                new TeamAggregateResult(7, 5200, 1500, 0, 0, 1, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("SEPARATION_WINDOW", evidence.getFirst().labels().get("kind"));
        assertEquals("STATIONARY", evidence.getFirst().labels().get("movementState"));
        assertTrue(evidence.getFirst().numbers().get("distanceM") > 0);
        assertTrue(evidence.getFirst().numbers().get("observedEnemyNearby") > 0);
        assertTrue(evidence.getFirst().numbers().containsKey("damageReceivedDuringSpan"));
        assertTrue(evidence.getFirst().numbers().containsKey("damageDealtDuringSpan"));
        assertTrue(evidence.getFirst().numbers().containsKey("mainClusterDisplacementM"));
        assertTrue(evidence.getFirst().numbers().containsKey("otherFriendlyDeathsDuringSpan"));
        assertTrue(evidence.getFirst().numbers().containsKey("otherFriendlyEngagementCountDuringSpan"));
        // 不得出现战术 verdict 词汇
        assertFalse(evidence.getFirst().summary().contains("拖延"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("脱节"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("队友获利"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().numbers().containsKey("teammateBenefit"));
        assertFalse(evidence.getFirst().labels().containsKey("intent"));
    }

    @Test
    void movingPushEmitsNeutralSeparationWindowNotDetach() {
        // 旧逻辑会输出 SOLO_DETACHED（移动+拉大距离+无获利+被白吃）；现在只输出中性事实
        final Battle battle = battle(3, new double[]{0, 0, 90, 0, 0, 0, 0}, new long[7]);
        final TeamMemberFeatureSet solo = member(0, 1800, false, 90.0,
                List.of(move(45, 90, 0, 0, -150, -100, 5f)), List.of(), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 90, 150, 180, 100, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3200, 3200, 0, 0, 0, 6, 1, 90.0, 90.0, 90.0, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("SEPARATION_WINDOW", evidence.getFirst().labels().get("kind"));
        assertEquals("MOVING", evidence.getFirst().labels().get("movementState"));
        assertFalse(evidence.getFirst().summary().contains("脱节"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("无掩护"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().summary().contains("拖延"), evidence.getFirst().summary());
        assertFalse(evidence.getFirst().numbers().containsKey("teammateBenefit"));
    }

    @Test
    void contradictorySignalsProduceNoCandidate() {
        // 部分重叠交火：压力/承伤无法可靠归属 → 不硬出（与旧契约一致）
        final Battle battle = battle(2, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 400, true, null,
                List.of(stationary(115, 260, 150, 100)),
                List.of(engagement(130, 200, 10_001L, List.of(20_002L), 300)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(120, 135, 400, 350, 400, 350, 260, 260, 260, 260, "account:10001"),
                new TeamAggregateResult(7, 3500, 2600, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(), "partially overlapping engagement must not yield a hard candidate");
    }

    @Test
    void fiveTwoSplitOnlyOffMainMemberEmitsNeutralEvidence() {
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

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        // 5+2 分簇：主力 5 人（P0-P4）+ 独立 2 人（P5-P6）→ 两个 off-main 成员都产生中性分离窗口
        assertEquals(2, evidence.size(), "both off-main members must be candidates");
        for (final AiEvidence e : evidence) {
            assertEquals("SEPARATION_WINDOW", e.labels().get("kind"));
            assertFalse(e.summary().contains("P0"), "main-cluster member must never be flagged");
            assertFalse(e.summary().contains("拖延"), e.summary());
        }
        assertTrue(evidence.stream().anyMatch(e -> e.summary().contains("P6")),
                "candidate must include the small-cluster member P6");
        assertTrue(evidence.stream().anyMatch(e -> e.summary().contains("P5")),
                "candidate must include the small-cluster member P5");
    }

    @Test
    void missingBattlePhasesDoesNotTreatWholeBattleAsOpening() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final TeamBattleFeatureSet features = features(
                List.of(member(0, 0, true, null, List.of(), List.of(), 1)),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 4200, 600, 0, 0, 0, 7, 0, null, null, null, true),
                List.of());

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        // 无 battle phases 时不得生成 OPENING_SPREAD（未证明开局边界）
        for (final AiEvidence e : evidence) {
            assertFalse("OPENING_SPREAD".equals(e.labels().get("kind")),
                    "without battle phases no OPENING_SPREAD may be emitted: " + e.summary());
        }
    }

    @Test
    void mainClusterTieIsAmbiguousAndProducesNothing() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final List<TeamMemberFeatureSet> members = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            members.add(member(index, 0, true, null, List.of(), List.of(), 1));
        }
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

        assertNull(TeamSeparationEvidenceSkill.mainClusterOf(phase));
        assertTrue(TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN).isEmpty());
    }

    @Test
    void partialObservationDoesNotDeclareMainCluster() {
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

        assertNull(TeamSeparationEvidenceSkill.mainClusterOf(phase, 7),
                "observed subset must not be declared global main cluster");
        final TeamBattleFeatureSet features = features(
                members, List.of(phase),
                new TeamAggregateResult(7, 1000, 500, 0, 0, 0, 7, 0, null, null, null, true),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        assertTrue(TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN).isEmpty());
    }

    @Test
    void soloWindowsWithMissingPhaseAreNotMerged() {
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

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "separation windows separated by a missing phase must not merge across the gap");
    }

    @Test
    void thinMovementCoverageIsUnknownNotMoving() {
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

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        // 覆盖不足 → movementState=UNKNOWN（不得按 MOVING 下结论），但分离窗口事实仍输出
        assertFalse(evidence.isEmpty(), "separation window facts must still be emitted");
        for (final AiEvidence e : evidence) {
            assertEquals("UNKNOWN", e.labels().get("movementState"), e.summary());
            assertFalse(e.summary().contains("脱节"), e.summary());
            assertFalse(e.summary().contains("拖延"), e.summary());
        }
    }

    @Test
    void partiallyOverlappingEngagementIsNotAttributedToSpan() {
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(move(60, 90, 100, 150, 0, 150, 2f)),
                List.of(engagement(40, 65, 10_001L, List.of(20_001L), 1000)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 90, 100, 150, 0, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "partially overlapping engagement must not contribute its full damage to the span");
    }

    @Test
    void engagementFullyInsideSpanOutputsFacts() {
        // 交火完全位于 span 内：整段承伤可正常归属 → 输出中性 SEPARATION_WINDOW 事实
        final Battle battle = battle(3, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(move(60, 90, 100, 150, 0, 150, 2f)),
                List.of(engagement(60, 90, 10_001L, List.of(20_001L), 1000)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(60, 90, 100, 150, 0, 150, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 3000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(40, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertEquals(1, evidence.size());
        assertEquals("SEPARATION_WINDOW", evidence.getFirst().labels().get("kind"));
        assertTrue(evidence.getFirst().numbers().get("damageReceivedDuringSpan") >= 1000);
        assertFalse(evidence.getFirst().summary().contains("脱节"), evidence.getFirst().summary());
    }

    @Test
    void partiallyOverlappingEngagementAtOpeningBoundarySuppressesOpening() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(stationary(15, 45, 350, 400)),
                List.of(engagement(40, 65, 10_001L, List.of(20_001L), 200)), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 1000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(60, 300));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        assertTrue(evidence.isEmpty(),
                "partially overlapping engagement at opening boundary must not be misattributed");
    }

    @Test
    void observedDamagePartialSuppressesOpeningAndNeverEmitsTacticalVerdict() {
        final Battle battle = battle(1, new double[7], new long[7]);
        final TeamMemberFeatureSet solo = member(0, 0, true, null,
                List.of(stationary(15, 45, 350, 400)),
                List.of(), 1);
        final TeamBattleFeatureSet features = features(
                List.of(solo, member(1, 0, true, null, List.of(), List.of(), 1)),
                phases(15, 45, 350, 400, 350, 400, 300, 250, 300, 250, "account:10001"),
                new TeamAggregateResult(7, 3000, 1000, 0, 0, 0, 7, 0, null, null, null, false),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                1,
                List.of(TeamSeparationEvidenceSkill.OBSERVED_DAMAGE_IS_PARTIAL));

        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(), MapTacticalSemantics.UNKNOWN);

        // partial 覆盖不得用“没有观察到”证明未接火 → 不生成 OPENING_SPREAD；也不得生成任何战术 verdict
        for (final AiEvidence e : evidence) {
            assertFalse("OPENING_SPREAD".equals(e.labels().get("kind")), e.summary());
            assertFalse(e.summary().contains("拖延") || e.summary().contains("脱节"), e.summary());
        }
    }

    // ===== helpers（与原测试一致） =====

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
        return features(members, formationPhases, aggregate, battlePhases, perspectiveTeam, List.of());
    }

    private static TeamBattleFeatureSet features(
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
                DecodeConfidence.PARTIAL);
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
            player.deathTimeSource = deathSecs[index] > 0
                    ? DeathTimeSource.SETTLEMENT_SECOND : DeathTimeSource.UNKNOWN;
            player.victoryPointsEarned = (int) earned[index];
            battle.players.add(player);
        }
        return battle;
    }
}