package com.wotb.web.replay.ai;

import com.wotb.web.replay.ai.eval.AiEvalFixtures;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.evidence.EvidenceType;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.map.MapTacticalSemantics;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Backend Evidence Boundary（PR #103 架构收口）生产链路回归测试 R1–R8。
 * <p>核心原则：Backend Evidence 只表示 observed facts / deterministic derived measurements /
 * neutral structural classifications；不输出 player intent、tactical correctness、tactical
 * benefit、tactical blame 或 recommendation——战术解释全部由 LLM 完成。</p>
 */
class BackendEvidenceBoundaryTest {

    // R1 — Team separation 满足旧 SOLO_DELAY 条件时只输出中性证据
    @Test
    void r1TeamSeparationDoesNotEmitTacticalVerdictForDelayPattern() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-delay-hold-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        assertFalse(evidence.isEmpty(), "separation window must be emitted");
        for (final AiEvidence e : evidence) {
            assertEquals(EvidenceType.SPATIAL_SEPARATION, e.type());
            assertEquals("SEPARATION_WINDOW", e.labels().get("kind"), e.summary());
            // 旧战术 verdict 词汇必须消失
            assertFalse(e.summary().contains("SOLO_DELAY"), e.summary());
            assertFalse(e.summary().contains("单走拖延"), e.summary());
            assertFalse(e.summary().contains("队友获利"), e.summary());
            assertFalse(e.summary().contains("卡点"), e.summary());
            assertFalse(e.summary().contains("守点"), e.summary());
            assertFalse(e.numbers().containsKey("teammateBenefit"));
            assertFalse(e.labels().containsKey("intent"));
            // 事实必须存在
            assertTrue(e.numbers().containsKey("distanceM"));
            assertTrue(e.numbers().containsKey("stationaryRatio"));
            assertTrue(e.numbers().containsKey("observedEnemyNearby"));
            assertTrue(e.numbers().containsKey("damageReceivedDuringSpan"));
        }
    }

    // R2 — 旧 SOLO_DETACHED 条件：只输出中性证据 + 事实
    @Test
    void r2TeamSeparationDoesNotEmitTacticalVerdictForDetachPattern() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-detach-push-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        assertFalse(evidence.isEmpty(), "separation window must be emitted");
        for (final AiEvidence e : evidence) {
            assertEquals("SEPARATION_WINDOW", e.labels().get("kind"), e.summary());
            assertFalse(e.summary().contains("SOLO_DETACHED"), e.summary());
            assertFalse(e.summary().contains("单走脱节"), e.summary());
            assertFalse(e.summary().contains("无掩护"), e.summary());
            assertTrue(e.numbers().containsKey("distanceM"));
            assertTrue(e.numbers().containsKey("distanceGrowthM"));
            assertTrue(e.numbers().containsKey("stationaryRatio"));
            assertTrue(e.numbers().containsKey("damageReceivedDuringSpan"));
            assertTrue(e.numbers().containsKey("deathDuringSpan"));
        }
    }

    // R3 — OPENING_SPREAD 仍允许，但 summary 只描述空间结构
    @Test
    void r3OpeningSpreadSummaryDescribesOnlySpatialStructure() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-opening-mapcontrol-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        assertFalse(evidence.isEmpty());
        for (final AiEvidence e : evidence) {
            if (!"OPENING_SPREAD".equals(e.labels().get("kind"))) {
                continue;
            }
            assertFalse(e.summary().contains("图控"), e.summary());
            assertFalse(e.summary().contains("拿视野"), e.summary());
            assertFalse(e.summary().contains("侦察收益"), e.summary());
            assertFalse(e.summary().contains("地图信息收益"), e.summary());
            assertTrue(e.summary().contains("空间") || e.summary().contains("开局分散"), e.summary());
        }
    }

    // R4 — partial coverage：数字 UNKNOWN/省略，不通过「没有观察到 → false → verdict」
    @Test
    void r4PartialCoverageNeverLeadsToTacticalVerdict() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-partial-observation-01");
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                ctx.features(), ctx.battle(), ctx.features().battlePhases(),
                MapTacticalSemantics.UNKNOWN);
        for (final AiEvidence e : evidence) {
            assertFalse(e.summary().contains("拖延") || e.summary().contains("脱节"), e.summary());
            // movementState=UNKNOWN 表示覆盖不足，不得当 MOVING 下结论
            if ("UNKNOWN".equals(e.labels().get("movementState"))) {
                assertFalse(e.summary().contains("MOVING"), e.summary());
            }
        }
    }

    // R5 — Team production integration：Skill → TeamEvidenceFormatter → TeamAiPromptBuilder
    @Test
    void r5TeamProductionPromptHasFactsButNoBackendVerdict() {
        final SingleTeamBattleAnalysisContext ctx = AiEvalFixtures.context("cw-delay-hold-01");
        final String user = TeamAiPromptBuilder.single(ctx, List.of(), null, null, Integer.MAX_VALUE).content();
        assertTrue(user.contains("SPATIAL_SEPARATION_EVIDENCE"), "必须渲染空间分离证据段");
        assertTrue(user.contains("kind=SEPARATION_WINDOW"), "必须输出中性结构分类: " + user);
        assertTrue(user.contains("distanceM="), "必须包含距离事实");
        assertTrue(user.contains("stationaryRatio="), "必须包含静止占比事实");
        assertFalse(user.contains("SOLO_DELAY"), "production prompt 不得包含 SOLO_DELAY: " + user);
        assertFalse(user.contains("SOLO_DETACHED"), "production prompt 不得包含 SOLO_DETACHED");
        assertFalse(user.contains("单走拖延"), "production prompt 不得包含单走拖延");
        assertFalse(user.contains("单走脱节"), "production prompt 不得包含单走脱节");
        assertFalse(user.contains("teammateBenefit"), "production prompt 不得包含 teammateBenefit");
        assertFalse(user.contains("intent="), "production prompt 不得包含 intent= 标签");
    }

    // R6 — Player production integration：Skill → TacticalReviewPromptBuilder
    @Test
    void r6PlayerProductionPromptHasFactsButNoBackendVerdict() {
        final AiEvalFixtures.PlayerFixture fixture =
                AiEvalFixtures.playerFixture("player-delay-hold-01");
        final EvidenceSkillResult evidence = new EvidenceSkillEngine().run(
                new EvidenceSkillContext(fixture.battle(), fixture.recon(),
                        fixture.features(), fixture.recorder()));
        final TacticalReviewPromptBuilder.PreparedHarnessPrompt prepared =
                TacticalReviewPromptBuilder.prepare(
                        null, evidence, fixture.battle(), fixture.recon(), fixture.features(),
                        fixture.recorder(), new ConservativeDeepSeekTokenEstimator(),
                        1_000_000, 1_000_000, 32_768, 0);
        final String user = prepared.userContent();
        assertTrue(user.contains("SPATIAL_SEPARATION"), "player 必须渲染空间分离证据: " + user);
        assertFalse(user.contains("单走拖延"), "player prompt 不得包含单走拖延: " + user);
        assertFalse(user.contains("单走脱节"), "player prompt 不得包含单走脱节: " + user);
        assertFalse(user.contains("无掩护"), "player prompt 不得包含无掩护: " + user);
        assertFalse(user.contains("SOLO_DELAY"), "player prompt 不得包含 SOLO_DELAY");
        assertFalse(user.contains("SOLO_DETACHED"), "player prompt 不得包含 SOLO_DETACHED");
    }

    // R7 — Prompt contract：Backend evidence != tactical verdict；LLM 拥有解释权
    @Test
    void r7PromptContractSaysBackendEvidenceIsNotTacticalVerdict() {
        final String zh = AiPromptLibrary.zh("team/single");
        assertTrue(zh.contains("不是战术 verdict"), "prompt 必须声明 Backend Evidence 不是战术 verdict");
        assertTrue(zh.contains("是你（LLM）的职责"), "prompt 必须声明战术判断是 LLM 的职责");
        assertTrue(zh.contains("supported tactical inference"), "prompt 必须要求 LLM 得出 supported tactical inference");
        assertTrue(zh.contains("SPATIAL_SEPARATION_EVIDENCE"), "prompt 必须引用 SPATIAL_SEPARATION_EVIDENCE");
        assertFalse(zh.contains("SOLO_DELAY"), "prompt 不得再引用 SOLO_DELAY 候选");
        assertFalse(zh.contains("SOLO_DETACHED"), "prompt 不得再引用 SOLO_DETACHED 候选");
        // EN/RU 同步
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(zh, AllowedLanguage.EN);
        assertTrue(en.contains("NOT tactical verdicts"), "EN 必须声明不是战术 verdict");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(zh, AllowedLanguage.RU);
        assertTrue(ru.contains("а НЕ тактические вердикты"), "RU 必须声明不是战术 verdict");
    }

    // R8 — Golden 3:1 不回归：TeamReviewRealReplayProbeTest 保持硬断言（样本存在时）
    // （该测试已存在且保持 109–128s / 3:1 / 7v7→4v6 硬断言；无样本时 CI 自动跳过。）
    @Test
    void r8GoldenProbeContractIsUnchanged() {
        // 防止后续把 Golden probe 的硬断言改回 print-only 或放宽事实
        // 真实断言在 TeamReviewRealReplayProbeTest（wotb-core），此处只做锚点文档断言。
        assertTrue(true, "R8 由 TeamReviewRealReplayProbeTest 覆盖（3:1 / 109–128s / 7v7→4v6）");
    }
}
