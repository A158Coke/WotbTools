package com.wotb.web.replay.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.core.replay.feature.KeyBattleEvent;

import java.util.List;

/**
 * AI 战术复盘接口的响应。
 */
public record AnalyzeResponse(
        @JsonProperty("analysis") String analysis,
        @JsonProperty("model") String model,
        @JsonProperty("packetCount") int packetCount,
        @JsonProperty("participantCount") int participantCount,
        @JsonProperty("eventCount") int eventCount,
        @JsonProperty("keyEvents") List<KeyBattleEvent> keyEvents
) {
}
