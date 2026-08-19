package com.wotb.web.replay.ai;

import java.util.List;
import java.util.Map;

/**
 * Call #1（Pre-Battle Strategic Prior）的结构化输出契约（文档 §9/§10）。
 * <p>由 LLM 在完全不知道比赛结果的情况下产出；Backend 只负责解析与传输，
 * 不修改其中任何战术内容。字段缺失时解析器用空值兜底。</p>
 */
public record PreBattleStrategicPrior(
        TeamProfile teamA,
        TeamProfile teamB,
        List<KeyMatchup> keyMatchups,
        List<StrategicWinCondition> strategicWinConditions,
        List<StrategicHypothesis> hypotheses
) {
    public PreBattleStrategicPrior {
        keyMatchups = keyMatchups == null ? List.of() : List.copyOf(keyMatchups);
        strategicWinConditions = strategicWinConditions == null
                ? List.of() : List.copyOf(strategicWinConditions);
        hypotheses = hypotheses == null ? List.of() : List.copyOf(hypotheses);
    }

    public boolean hasContent() {
        return (teamA != null && (teamA.hasContent()))
                || (teamB != null && teamB.hasContent())
                || !keyMatchups.isEmpty()
                || !strategicWinConditions.isEmpty()
                || !hypotheses.isEmpty();
    }

    /**
     * 单方阵容战术画像。
     */
    public record TeamProfile(
            Map<String, String> composition,
            List<String> strengths,
            List<String> weaknesses,
            List<String> preferredPlans
    ) {
        public TeamProfile {
            composition = composition == null ? Map.of() : Map.copyOf(composition);
            strengths = strengths == null ? List.of() : List.copyOf(strengths);
            weaknesses = weaknesses == null ? List.of() : List.copyOf(weaknesses);
            preferredPlans = preferredPlans == null ? List.of() : List.copyOf(preferredPlans);
        }

        boolean hasContent() {
            return !composition.isEmpty() || !strengths.isEmpty()
                    || !weaknesses.isEmpty() || !preferredPlans.isEmpty();
        }
    }

    /**
     * 关键区域对阵优劣势。area 在 V1 只能是 GRID_REGION_N 或抽象描述。
     */
    public record KeyMatchup(String area, String advantage, String reason) {
    }

    public record StrategicWinCondition(String team, String condition) {
    }

    /**
     * 战略假设：团队复盘在 Call #2 中与实际情况对照（预期 vs 实际，考虑一波流等特殊战局）；随机战 harness 仍支持逐条状态判定。
     */
    public record StrategicHypothesis(String id, String claim, String reason) {
    }
}
