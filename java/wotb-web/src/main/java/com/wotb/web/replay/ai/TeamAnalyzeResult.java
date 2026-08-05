package com.wotb.web.replay.ai;

import java.util.List;

import com.wotb.core.processing.AnalysisUnitResult;

/**
 * Team AI 文本与每个独立 perspective 的事实报告。
 *
 * @param analysis 首个分区（输入顺序的第一个分区）的 AI 复盘结果。
 *                 当所有 context 被合并为单个分区时为该分区结果；
 *                 多分区时取自第一个输入 context 所属分区。
 *                 分区顺序 = 输入顺序，由 Team 编排保证确定性。
 * @param units    每个独立 perspective 的分析单元结果列表
 */
public record TeamAnalyzeResult(
        AnalyzeResult analysis,
        List<AnalysisUnitResult> units,
        int analysisUnitCount,
        int analyzedUnitCount,
        int omittedAnalysisUnitCount,
        List<String> limitations
) {
    public TeamAnalyzeResult {
        units = units == null ? List.of() : List.copyOf(units);
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }
}