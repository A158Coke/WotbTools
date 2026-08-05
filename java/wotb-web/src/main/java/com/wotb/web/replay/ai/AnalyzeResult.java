package com.wotb.web.replay.ai;

import java.util.List;

import com.wotb.core.replay.feature.KeyBattleEvent;

/**
 * AI 复盘结果（文本 + 使用的模型 + 关键事件死亡时间线）。
 * <p>由 {@link PlayerReplayAnalysisService} 与 {@link TeamReplayAnalysisService}
 * 共同返回；也用于 {@link TeamAnalyzeResult} 顶层 {@code analysis} 字段。</p>
 *
 * @param analysis  AI 生成的战术复盘文本
 * @param model     使用的模型
 * @param keyEvents 关键事件（死亡时间线，来自结算数据）
 */
public record AnalyzeResult(String analysis, String model, List<KeyBattleEvent> keyEvents) {
    public AnalyzeResult {
        keyEvents = keyEvents == null ? List.of() : List.copyOf(keyEvents);
    }
}