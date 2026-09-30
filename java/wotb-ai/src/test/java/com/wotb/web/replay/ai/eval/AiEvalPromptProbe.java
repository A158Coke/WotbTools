package com.wotb.web.replay.ai.eval;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.web.replay.ai.AiPromptLibrary;
import com.wotb.web.replay.ai.TacticalReviewPromptBuilder;
import com.wotb.web.replay.ai.TeamAiPromptBuilder;

import java.util.List;

/** 不调 AI：按 golden case 构建 user/system prompt（team/player 按 mode 分流）。 */
public final class AiEvalPromptProbe {

    private AiEvalPromptProbe() {
    }

    public static String prompt(final AiEvalCase caze) {
        if ("PLAYER_FOCUSED".equals(caze.mode())) {
            return playerPrompt(caze);
        }
        final SingleTeamBattleAnalysisContext context = AiEvalFixtures.context(caze.fixtureKey());
        return TeamAiPromptBuilder.single(context, List.of(), null, null, Integer.MAX_VALUE).content();
    }

    /** 返回实际 team system prompt，供模块化战术技能的契约断言使用。 */
    public static String systemPrompt(final AiEvalCase caze) {
        if ("PLAYER_FOCUSED".equals(caze.mode())) {
            return "";
        }
        return AiPromptLibrary.zh("team/single");
    }

    /** player 路径：真实证据链（EvidenceSkillEngine 含 PlayerSeparationEvidenceSkill）→ TacticalReviewPromptBuilder。 */
    private static String playerPrompt(final AiEvalCase caze) {
        final AiEvalFixtures.PlayerFixture fixture = AiEvalFixtures.playerFixture(caze.fixtureKey());
        final EvidenceSkillResult evidence = new EvidenceSkillEngine().run(new EvidenceSkillContext(
                fixture.battle(), fixture.recon(), fixture.features(), fixture.recorder()));
        final TacticalReviewPromptBuilder.PreparedHarnessPrompt prepared =
                TacticalReviewPromptBuilder.prepare(
                        null, evidence, fixture.battle(), fixture.recon(), fixture.features(),
                        fixture.recorder(), new ConservativeDeepSeekTokenEstimator(),
                        1_000_000, 1_000_000, 32_768, 0);
        return prepared.userContent();
    }
}
