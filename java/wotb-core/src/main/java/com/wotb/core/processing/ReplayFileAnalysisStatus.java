package com.wotb.core.processing;

/**
 * AI 分析响应中每个文件的处理状态。
 *
 * @param fileName             文件名
 * @param status               处理状态
 * @param capabilities         能力标记
 * @param analysisIncluded     该文件是否进入 AI 分析
 * @param duplicate            是否被判定为重复
 * @param summaryError         战绩解析错误（如有）
 * @param reconstructionError  重建错误（如有）
 */
public record ReplayFileAnalysisStatus(
        String fileName,
        ReplayProcessingStatus status,
        ReplayProcessingCapabilities capabilities,
        boolean analysisIncluded,
        boolean duplicate,
        ReplayProcessingError summaryError,
        ReplayProcessingError reconstructionError
) {

    public static ReplayFileAnalysisStatus from(ReplayProcessingResult result, boolean included) {
        return new ReplayFileAnalysisStatus(
                result.fileName(),
                result.status(),
                result.capabilities(),
                included,
                false,
                null, null
        );
    }
}
