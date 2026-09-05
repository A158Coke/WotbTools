package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamAiReviewResult;
import com.wotb.web.replay.dto.AnalyzeResponse;

import java.util.List;

/**
 * Team AI 结果：保留文本摘要兼容字段，并携带 v0.5 structured result。
 *
 * @param analysis         首个分区（输入顺序的第一个分区）的 AI 复盘结果。
 *                         当所有 context 被合并为单个分区时为该分区结果；
 *                         多分区时取自第一个输入 context 所属分区。
 *                         分区顺序 = 输入顺序，由 Team 编排保证确定性。
 * @param structuredResult Team AI Review v0.5 结构化结果
 * @param preBattleSection 首个分区对应 Call #1 prior 的用户可见中文渲染
 *                         （{@link PreBattleSectionRenderer}）；Call #1 失败/降级时为 null。
 */
public record TeamAnalyzeResult(
        AnalyzeResult analysis,
        String preBattleSection,
        TeamAiReviewResult structuredResult,
        List<AnalyzeResponse.TeamPlayer> teamPlayers
) {
    public TeamAnalyzeResult {
        teamPlayers = teamPlayers == null ? List.of() : List.copyOf(teamPlayers);
    }

    public TeamAnalyzeResult(final AnalyzeResult analysis) {
        this(analysis, null, null, List.of());
    }

    public TeamAnalyzeResult(final AnalyzeResult analysis, final String preBattleSection) {
        this(analysis, preBattleSection, null, List.of());
    }

    public TeamAnalyzeResult(final AnalyzeResult analysis, final String preBattleSection,
                             final TeamAiReviewResult structuredResult) {
        this(analysis, preBattleSection, structuredResult, List.of());
    }
}
