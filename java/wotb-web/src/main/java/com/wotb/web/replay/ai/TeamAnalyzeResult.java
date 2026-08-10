package com.wotb.web.replay.ai;

/**
 * Team AI 文本。
 *
 * @param analysis         首个分区（输入顺序的第一个分区）的 AI 复盘结果。
 *                         当所有 context 被合并为单个分区时为该分区结果；
 *                         多分区时取自第一个输入 context 所属分区。
 *                         分区顺序 = 输入顺序，由 Team 编排保证确定性。
 * @param preBattleSection 首个分区对应 Call #1 prior 的用户可见中文渲染
 *                         （{@link PreBattleSectionRenderer}）；Call #1 失败/降级时为 null。
 */
public record TeamAnalyzeResult(AnalyzeResult analysis, String preBattleSection) {

    public TeamAnalyzeResult(final AnalyzeResult analysis) {
        this(analysis, null);
    }
}
