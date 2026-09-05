package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import com.wotb.web.replay.ai.eval.TeamQualityGoldEvaluator;
import com.wotb.web.replay.ai.eval.TeamQualityShortcutValidator;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamQualityContractTest {

    @Test
    void primaryDiagnosisCarriesStructuralBasisAndParserRejectsUnknownBasis() {
        final TeamReviewEnvelope parsed = TeamReviewEnvelopeParser.parse(
                "{\"primaryDiagnosis\":{\"title\":\"位置判断\",\"reasoning\":\"局部交火后未及时合流\","
                        + "\"evidenceBasis\":[\"POSITION\",\"LOCAL_ENGAGEMENT\"]},"
                        + "\"reviewMarkdown\":\"## 团队复盘\\n\\n局部交火后未及时合流。\",\"claims\":[]}");
        assertEquals(List.of("POSITION", "LOCAL_ENGAGEMENT"), parsed.primaryDiagnosis().evidenceBasis());
        assertTrue(TeamQualityShortcutValidator.passes(parsed));

        assertFalse(TeamReviewEnvelopeParser.parseDetailed(
                "{\"primaryDiagnosis\":{\"title\":\"x\",\"reasoning\":\"y\",\"evidenceBasis\":[\"MADE_UP\"]},"
                        + "\"reviewMarkdown\":\"ok\",\"claims\":[]}").envelope() != null,
                "evidenceBasis must be a bounded enum contract");
    }

    @Test
    void settlementShortcutsAreRejectedButStructuralConclusionPasses() {
        final TeamReviewEnvelope settlementOnly = envelope(
                "低伤害所以失败", "本场问题是伤害低。", List.of("HP_TRADE"), "伤害低因此失败。");
        assertTrue(TeamQualityShortcutValidator.validate(settlementOnly).stream()
                        .anyMatch(v -> v.code().equals("SETTLEMENT_ONLY_DIAGNOSIS")));

        final TeamReviewEnvelope structural = envelope(
                "侧翼压力后的合流速度不足", "位置与局部交火证据支持这个判断。",
                List.of("POSITION", "LOCAL_ENGAGEMENT"), "侧翼压力形成后，主力正面的交战条件恶化。");
        assertTrue(TeamQualityShortcutValidator.passes(structural));
    }

    @Test
    void deterministicShortcutRulesCoverKnownFailurePatterns() {
        assertViolation("距离很远所以脱节。", "DISTANCE_TO_DETACHED_SHORTCUT");
        assertViolation("轻坦必须侦察。", "VEHICLE_CLASS_ROLE_SHORTCUT");
        assertViolation("没点亮就说明这条路没人。", "VISION_ABSENCE_SHORTCUT");
        assertViolation("5v3 必须推进。", "NUMERIC_PUSH_SHORTCUT");
        final TeamReviewEnvelope deathCluster = envelope("现象", "暂无结构性依据", List.of("HP_TRADE"), "多辆车集中阵亡。");
        assertTrue(TeamQualityShortcutValidator.validate(deathCluster).stream()
                        .anyMatch(v -> v.code().equals("DEATH_CLUSTER_WITHOUT_CAUSE")));
    }

    @Test
    void promptPublishesReasoningOrderAndSafeEvidenceBasisContract() {
        final String prompt = TeamPromptLocalizer.SINGLE_TEAM_PROMPT;
        assertTrue(prompt.contains("A 开局信息"));
        assertTrue(prompt.contains("H HP/阵亡验证"));
        assertTrue(prompt.contains("evidenceBasis"));
        assertTrue(prompt.contains("不能成为主判断的唯一依据"));
        assertTrue(prompt.indexOf("A 开局信息") < prompt.indexOf("H HP/阵亡验证"));
    }

    @Test
    void goldPreflightReportsNoticeHitsAndMustNotViolationsWithoutSemanticJudge() {
        final TeamQualityGoldEvaluator.Evaluation evaluation = TeamQualityGoldEvaluator.evaluate(
                new com.wotb.web.replay.ai.eval.TeamReplayQualityCase(
                        "case", "fixture", List.of("separate_flank_local"),
                        List.of("automatic_push_rule"), List.of("POSITION_REGION")),
                "侧翼局部传播改善了主力交战条件；5v3必须推进。");
        assertEquals(List.of("separate_flank_local"), evaluation.mustNoticeHits());
        assertTrue(evaluation.mustNoticeMisses().isEmpty());
        assertEquals(List.of("automatic_push_rule"), evaluation.mustNotViolations());
    }

    private static void assertViolation(final String review, final String code) {
        final TeamReviewEnvelope envelope = envelope("可观察现象", "位置与交火信息", List.of("POSITION"), review);
        assertTrue(TeamQualityShortcutValidator.validate(envelope).stream()
                        .anyMatch(v -> v.code().equals(code)), review);
    }

    private static TeamReviewEnvelope envelope(final String title,
                                               final String reasoning,
                                               final List<String> basis,
                                               final String review) {
        return new TeamReviewEnvelope(
                new TeamReviewEnvelope.PrimaryDiagnosis(title, reasoning, List.of(), basis), review, List.of());
    }
}
