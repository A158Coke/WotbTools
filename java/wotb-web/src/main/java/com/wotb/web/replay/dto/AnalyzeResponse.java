package com.wotb.web.replay.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.core.replay.feature.KeyBattleEvent;

import java.util.List;

/**
 * AI 战术复盘接口的响应（单场或多场）。
 *
 * @param mode        分析模式：SINGLE_BATTLE / MULTI_BATTLE
 * @param analysis    AI 生成的复盘文本
 * @param model       使用的模型
 * @param battleCount 实际用于分析的可分析回放数量（以战绩为准）
 * @param keyEvents   关键事件（单场=死亡时间线；多场为空）
 */
public record AnalyzeResponse(
        @JsonProperty("mode") String mode,
        @JsonProperty("analysis") String analysis,
        @JsonProperty("model") String model,
        @JsonProperty("battleCount") int battleCount,
        @JsonProperty("keyEvents") List<KeyBattleEvent> keyEvents
) {
}
