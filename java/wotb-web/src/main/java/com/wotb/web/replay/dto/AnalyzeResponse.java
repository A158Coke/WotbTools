package com.wotb.web.replay.dto;

/**
 * AI 战术复盘响应：复盘正文 + 可选的「赛前预测」区块。
 * <p>前端 {@code AnalysisResultPanel.vue} 消费
 * {@code analysis}（复盘正文）与 {@code preBattleSection}（Call #1 赛前预测的用户
 * 可见中文渲染，后端生成）；Call #1 失败/降级/非中文时 {@code preBattleSection} 为
 * {@code null}，前端不显示该区块。地图鸟瞰（mapOverview）不属于 AI 复盘响应——
 * 由独立 Processing Job 的 canonical {@code map-overview.json} artifact
 * （战局回放面板消费）承载。</p>
 *
 * @param analysis          AI 生成的战术复盘文本
 * @param preBattleSection  赛前预测区块（用户可见中文 Markdown；不可用时为 null）
 */
public record AnalyzeResponse(String analysis, String preBattleSection) {

    public AnalyzeResponse(final String analysis) {
        this(analysis, null);
    }
}
