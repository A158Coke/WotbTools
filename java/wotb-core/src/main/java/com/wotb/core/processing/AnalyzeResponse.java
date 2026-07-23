package com.wotb.core.processing;

import com.wotb.core.replay.feature.KeyBattleEvent;

import java.util.List;

/**
 * AI 分析统一响应。
 *
 * @param mode               分析模式
 * @param analysis           AI 分析文本
 * @param model              使用的 AI 模型标识
 * @param submittedFileCount 提交文件总数
 * @param analyzedBattleCount 实际分析场次数
 * @param successFileCount   成功文件数
 * @param partialFileCount   部分成功文件数
 * @param failedFileCount    失败文件数
 * @param duplicateFileCount 重复文件数
 * @param files              每个文件的处理状态
 * @param keyEvents          关键事件列表
 */
public record AnalyzeResponse(
        ReplayAnalysisMode mode,
        String analysis,
        String model,
        int submittedFileCount,
        int analyzedBattleCount,
        int successFileCount,
        int partialFileCount,
        int failedFileCount,
        int duplicateFileCount,
        List<ReplayFileAnalysisStatus> files,
        List<KeyBattleEvent> keyEvents
) {
}
