package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.map.MapTacticalSemantics;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static com.wotb.core.replay.evidence.TeamSeparationEvidenceFixtures.*;

/** Observation coverage and event-window boundaries for spatial separation evidence. */
class TeamSeparationEvidenceBoundaryTest {

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
}
