package com.wotb.core.processing;

import java.util.List;

/**
 * 多文件批量处理的统一返回结果。
 *
 * @param suggestedAnalysisMode 建议的 AI 分析模式
 * @param submittedFileCount    提交文件总数
 * @param successfulFileCount   成功文件数
 * @param partialFileCount      部分成功文件数
 * @param failedFileCount       失败文件数
 * @param results               逐文件结果（顺序与上传一致）
 * @param summary               批量汇总统计
 */
public record ReplayBatchProcessingResult(
        ReplayAnalysisMode suggestedAnalysisMode,
        int submittedFileCount,
        int successfulFileCount,
        int partialFileCount,
        int failedFileCount,
        List<ReplayProcessingResult> results,
        ReplayBatchSummary summary
) {
}
