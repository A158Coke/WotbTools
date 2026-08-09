package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EvidencePriority;
import com.wotb.core.replay.evidence.EvidenceProvenance;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.evidence.EvidenceType;
import com.wotb.core.replay.evidence.HpMomentumSkill;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

class TacticalReviewPromptBuilderTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();

    private static Battle battle() {
        final List<PlayerResult> players = new ArrayList<>();
        final PlayerResult rec = new PlayerResult();
        rec.accountId = 1001;
        rec.team = 1;
        rec.tankId = 4481;
        rec.tankName = "Kranvagn";
        rec.nickname = "rec1";
        rec.survived = true;
        players.add(rec);
        players.add(teamPlayer(1002, 1, 10785, "T110E5", true));
        players.add(teamPlayer(2001, 2, 14609, "Leopard 1", true));
        players.add(teamPlayer(2002, 2, 12305, "E 50 M", true));
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 300.0;
        b.recorder = "rec1";
        b.players = players;
        return b;
    }

    private static PlayerResult teamPlayer(final long accountId, final int team,
                                           final long tankId, final String tankName,
                                           final boolean survived) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.survived = survived;
        p.damageDealt = 1000;
        p.damageReceived = 800;
        return p;
    }

    private static PreBattleStrategicPrior prior() {
        return new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of("mobility", "HIGH"), List.of("s1"), List.of("w1"), List.of("p1")),
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of("mobility", "MEDIUM"), List.of("s2"), List.of("w2"), List.of("p2")),
                List.of(new PreBattleStrategicPrior.KeyMatchup("GRID_REGION_5", "TEAM_A", "r1")),
                List.of(new PreBattleStrategicPrior.StrategicWinCondition("TEAM_A", "c1")),
                List.of(new PreBattleStrategicPrior.StrategicHypothesis("H1", "claim1", "reason1")));
    }

    private static EvidenceSkillResult evidence() {
        final AiEvidence window = new AiEvidence(
                "CW_01", EvidenceType.CRITICAL_WINDOW, 168f, 197f,
                List.of(),
                Map.of("friendlyDeaths", 2.0, "teamHpLeadBefore", 780.0, "teamHpLeadAfter", -720.0),
                Map.of("localNumbersBefore", "4v3", "localNumbersAfter", "2v4"),
                DecodeConfidence.PARTIAL, EvidencePriority.CRITICAL,
                EvidenceProvenance.BACKEND_SKILL, "战局变化窗口：HP 优势 780→-720");
        final AiEvidence trade = new AiEvidence(
                "ET_01", EvidenceType.ENGAGEMENT_TRADE, 10f, 20f,
                List.of(),
                Map.of("damageDealt", 300.0, "damageReceived", 100.0),
                Map.of("localNumbersBefore", "4v3", "localNumbersAfter", "2v4"),
                DecodeConfidence.EXACT, EvidencePriority.IMPORTANT,
                EvidenceProvenance.BACKEND_SKILL, "换血：输出 300 / 承伤 100");
        final List<HpMomentumSkill.HpMomentumSample> series = List.of(
                new HpMomentumSkill.HpMomentumSample(0f, Map.of(), Map.of(), 4000, 4000, 0, 1.0, 8),
                new HpMomentumSkill.HpMomentumSample(60f, Map.of(), Map.of(), 4000, 3600, 400, 1.0, 8),
                new HpMomentumSkill.HpMomentumSample(120f, Map.of(), Map.of(), 4000, 2000, 2000, 1.0, 8));
        return new EvidenceSkillResult(List.of(trade), List.of(window), series);
    }

    private static TacticalReviewPromptBuilder.PreparedHarnessPrompt prepare(
            final int contextWindow, final int maxOutput, final int safety) {
        return TacticalReviewPromptBuilder.prepare(
                prior(),
                evidence(),
                battle(),
                null,
                new PlayerBattleFeatureSet(
                        List.of(), List.of(), List.of(), List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                ESTIMATOR,
                100_000,
                contextWindow,
                maxOutput,
                safety);
    }

    @Test
    void containsAllBookendSections() {
        final var prepared = prepare(131_072, 8192, 1000);
        assertTrue(prepared.userContent().contains("BATTLE SNAPSHOT"));
        assertTrue(prepared.userContent().contains("PRE-BATTLE STRATEGIC PRIOR"));
        assertTrue(prepared.userContent().contains("TOP PIVOTAL WINDOWS"));
        assertTrue(prepared.userContent().contains("TACTICAL EVIDENCE"));
        assertTrue(prepared.userContent().contains("CRITICAL DECISION WINDOWS"));
        assertTrue(prepared.userContent().contains("TASK"));
        assertTrue(prepared.userContent().contains("[H1]"));
        assertTrue(prepared.userContent().contains("战局变化窗口"));
        assertTrue(prepared.userContent().contains("HP 动量"));
    }

    @Test
    void controlledRedundancyShowsIndexAndDetail() {
        final var prepared = prepare(131_072, 8192, 1000);
        final String content = prepared.userContent();
        assertTrue(content.contains("2分48秒"), "TOP index must use battle clock");
        assertTrue(content.contains("WINDOW #1"), "detail section must exist");
    }

    @Test
    void taskIsTheLastBusinessSection() {
        final var prepared = prepare(131_072, 8192, 1000);
        final String content = prepared.userContent();
        assertTrue(content.indexOf("======================== TASK")
                        > content.indexOf("======================== CRITICAL DECISION WINDOWS"),
                "TASK 必须位于 CRITICAL DECISION WINDOWS 之后");
        assertTrue(content.lastIndexOf("======================== TASK")
                        > content.lastIndexOf("======================== TOP PIVOTAL WINDOWS"));
        assertTrue(content.lastIndexOf("======================== TASK")
                        > content.lastIndexOf("======================== BATTLE PHASE SUMMARY"));
        assertTrue(content.lastIndexOf("======================== TASK")
                        > content.lastIndexOf("======================== TACTICAL EVIDENCE"));
        assertTrue(content.lastIndexOf("======================== TASK")
                        > content.lastIndexOf("======================== CRITICAL DECISION WINDOWS"));
    }

    @Test
    void tinyBudgetTrimsOptionalSectionsButKeepsBookends() {
        final var prepared = prepare(2000, 500, 100);
        final String content = prepared.userContent();
        assertTrue(prepared.truncated());
        assertTrue(content.contains("BATTLE SNAPSHOT"), "Snapshot 永远不能被裁剪");
        assertTrue(content.contains("PRE-BATTLE STRATEGIC PRIOR"), "Prior 永远不能被裁剪");
        assertTrue(content.contains("======================== TASK"), "TASK 永远不能被裁剪");
        assertTrue(content.indexOf("======================== TASK")
                        > content.indexOf("======================== PRE-BATTLE STRATEGIC PRIOR"),
                "tiny budget 下 TASK 仍必须位于 Prior 之后");
        assertTrue(content.lastIndexOf("======================== TASK")
                        > content.lastIndexOf("======================== BATTLE SNAPSHOT"),
                "tiny budget 下 TASK 必须是最后一个业务 section");
    }
}
