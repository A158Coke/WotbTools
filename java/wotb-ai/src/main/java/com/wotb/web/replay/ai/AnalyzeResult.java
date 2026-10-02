package com.wotb.web.replay.ai;

/**
 * AI 复盘结果（文本）。
 * <p>由 {@link PlayerReplayAnalysisService} 与 {@link TeamReplayAnalysisService}
 * 共同返回（Team 路径的文本摘要取自 v0.5 structured result 的 {@code summary.verdict}）。</p>
 *
 * @param analysis  AI 生成的战术复盘文本
 */
public record AnalyzeResult(String analysis) {
}
