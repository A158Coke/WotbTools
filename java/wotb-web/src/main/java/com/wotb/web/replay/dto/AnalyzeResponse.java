package com.wotb.web.replay.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.core.processing.ReplayAnalysisMode;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.replay.feature.KeyBattleEvent;

import java.util.List;

/**
 * AI 战术复盘响应。
 *
 * @param mode               分析模式
 * @param analysis           AI 生成的复盘文本
 * @param model              使用的模型
 * @param submittedFileCount 提交文件总数
 * @param analyzedBattleCount 实际分析场次数
 * @param successFileCount   成功文件数
 * @param partialFileCount   部分成功文件数
 * @param failedFileCount    失败文件数
 * @param duplicateFileCount 重复文件数
 * @param files              每文件处理状态
 * @param keyEvents          关键事件
 */
public record AnalyzeResponse(
        @JsonProperty("mode") String mode,
        @JsonProperty("analysis") String analysis,
        @JsonProperty("model") String model,
        @JsonProperty("submittedFileCount") int submittedFileCount,
        @JsonProperty("analyzedBattleCount") int analyzedBattleCount,
        @JsonProperty("successFileCount") int successFileCount,
        @JsonProperty("partialFileCount") int partialFileCount,
        @JsonProperty("failedFileCount") int failedFileCount,
        @JsonProperty("duplicateFileCount") int duplicateFileCount,
        @JsonProperty("files") List<ReplayFileAnalysisStatus> files,
        @JsonProperty("keyEvents") List<KeyBattleEvent> keyEvents
) {
}
