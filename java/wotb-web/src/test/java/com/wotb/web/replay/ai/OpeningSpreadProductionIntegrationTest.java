package com.wotb.web.replay.ai;

import com.wotb.web.replay.ai.eval.AiEvalFixtures;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR #103 架构收口生产链路集成测试：TeamSeparationEvidenceSkill / PlayerSeparationEvidenceSkill
 * → TeamEvidenceFormatter / TacticalEvidenceFormatter → Call #2 user content。
 * <p>验证：OPENING_SPREAD（开局分散）以中性 signal 输出（summary 无拿视野/点亮/侦察），
 * 且 production Prompt 不暴露 OPENING_MAP_CONTROL 原始标签。</p>
 */
class OpeningSpreadProductionIntegrationTest {

    @Test
    void teamUserContentCarriesOpeningSpreadAsNeutralSignal() {
        final SingleTeamBattleAnalysisContext ctx =
                AiEvalFixtures.context("cw-opening-mapcontrol-01");
        final String user = TeamAiPromptBuilder.single(ctx, List.of(), null, null, Integer.MAX_VALUE).content();

        assertTrue(user.contains("SPATIAL_SEPARATION_EVIDENCE"), "必须渲染空间分离证据段");
        assertTrue(user.contains("kind=OPENING_SPREAD"),
                "必须输出 OPENING_SPREAD 中性结构分类: " + user);
        assertFalse(user.contains("kind=OPENING_MAP_CONTROL"),
                "production user content 不得暴露 OPENING_MAP_CONTROL: " + user);
        assertFalse(user.contains("intent="),
                "production user content 不得再出现 intent= 战术标签: " + user);
        assertFalse(user.contains("SOLO_INTENT_SIGNALS"),
                "旧 SOLO_INTENT_SIGNALS 段名必须删除: " + user);
        // summary 必须是中性「开局分散」，不得声称拿视野/提供视野/点亮/侦察收益
        assertTrue(user.contains("开局分散"),
                "summary 必须使用中性「开局分散」: " + user);
        assertFalse(user.contains("拿视野"), "summary 不得声称拿视野: " + user);
        assertFalse(user.contains("提供视野"), "summary 不得声称提供视野: " + user);
        assertFalse(user.contains("点亮"), "summary 不得声称点亮: " + user);
        assertFalse(user.contains("侦察收益"), "summary 不得声称侦察收益: " + user);
        assertFalse(user.contains("开局图控"), "summary 不得使用图控标签: " + user);
    }

    @Test
    void playerUserContentCarriesOpeningSpreadAsNeutralSignal() {
        final AiEvalFixtures.PlayerFixture fixture =
                AiEvalFixtures.playerFixture("player-opening-mapcontrol-01");
        final EvidenceSkillResult evidence = new EvidenceSkillEngine().run(
                new EvidenceSkillContext(fixture.battle(), fixture.recon(),
                        fixture.features(), fixture.recorder()));
        final TacticalReviewPromptBuilder.PreparedHarnessPrompt prepared =
                TacticalReviewPromptBuilder.prepare(
                        null, evidence, fixture.battle(), fixture.recon(), fixture.features(),
                        fixture.recorder(), new ConservativeDeepSeekTokenEstimator(),
                        1_000_000, 1_000_000, 32_768, 0);
        final String user = prepared.userContent();

        assertTrue(user.contains("OPENING_SPREAD") || user.contains("开局分散"),
                "player user content 必须携带 OPENING_SPREAD/开局分散: " + user);
        assertFalse(user.contains("OPENING_MAP_CONTROL"),
                "player user content 不得暴露 OPENING_MAP_CONTROL: " + user);
        assertFalse(user.contains("拿视野"), "player 不得声称拿视野: " + user);
        assertFalse(user.contains("成功点亮"), "player 不得声称成功点亮: " + user);
        assertFalse(user.contains("侦察收益"), "player 不得声称侦察收益: " + user);
    }
}
