package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.BattlePhaseSummary;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static com.wotb.core.replay.evidence.TeamSeparationEvidenceFixtures.*;

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
}
