package com.wotb.web.replay.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.core.processing.AnalysisUnitResult;
import com.wotb.core.processing.ReplayAnalysisMode;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.replay.feature.KeyBattleEvent;

import java.util.List;

/**
 * AI 战术复盘响应。
 * 注意前端 `ReconstructionPage.vue` 依赖以下字段：
 * - mode (String: SINGLE_PLAYER_BATTLE / MULTI_PLAYER_BATTLE)
 * - analysis (AI 复盘文本)
 * - battleCount (实际分析场次数)
 * - files (每文件状态)
 * - keyEvents (关键事件)
 */
public record AnalyzeResponse(
        @JsonProperty("mode") ReplayAnalysisMode mode,
        @JsonProperty("submittedFileCount") int submittedFileCount,
        @JsonProperty("validFileCount") int validFileCount,
        @JsonProperty("analysisUnitCount") int analysisUnitCount,
        @JsonProperty("analyzedUnitCount") int analyzedUnitCount,
        @JsonProperty("battleCount") int battleCount,
        @JsonProperty("analysis") String analysis,
        @JsonProperty("failedFileCount") int failedFileCount,
        @JsonProperty("exactDuplicateCount") int exactDuplicateCount,
        @JsonProperty("sameTeamDuplicatePerspectiveCount") int sameTeamDuplicatePerspectiveCount,
        @JsonProperty("files") List<ReplayFileAnalysisStatus> files,
        @JsonProperty("analyses") List<AnalysisUnitResult> analyses,
        @JsonProperty("keyEvents") List<KeyBattleEvent> keyEvents
) {
}
