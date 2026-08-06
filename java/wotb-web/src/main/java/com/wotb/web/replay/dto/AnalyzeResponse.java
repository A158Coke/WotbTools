package com.wotb.web.replay.dto;

/**
 * AI 战术复盘响应：仅包含复盘正文。
 * <p>前端 {@code ReconstructionPage.vue} / {@code AnalysisResultPanel.vue} 只消费
 * {@code analysis}；其余统计/诊断字段已被清理（无消费者，属于提前性载荷）。</p>
 */
public record AnalyzeResponse(String analysis) {
}
