package com.wotb.web.replay.ai.eval;

import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.web.replay.ai.TeamAiPromptBuilder;

import java.util.List;

/** 不调 AI：按 golden case 构建 team prompt 并返回渲染文本（供断言/报告）。 */
public final class AiEvalPromptProbe {

    private AiEvalPromptProbe() {
    }

    public static String prompt(final AiEvalCase caze) {
        final SingleTeamBattleAnalysisContext context = AiEvalFixtures.context(caze.fixtureKey());
        return TeamAiPromptBuilder.single(context, List.of(), null, null, Integer.MAX_VALUE).content();
    }
}
