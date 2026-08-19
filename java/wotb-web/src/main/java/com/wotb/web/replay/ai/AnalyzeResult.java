package com.wotb.web.replay.ai;

/**
 * AI 复盘结果（文本）。
 * <p>由 {@link PlayerReplayAnalysisService} 与 {@link TeamReplayAnalysisService}
 * 共同返回；也用于 {@link TeamAnalyzeResult} 顶层 {@code analysis} 字段。</p>
 *
 * @param analysis  AI 生成的战术复盘文本
 */
public record AnalyzeResult(String analysis) {
}
