package com.wotb.core.processing;

import java.util.List;

/**
 * 多文件批量处理的汇总统计（占位，后续扩展）。
 *
 * @param totalSubmitted      总提交文件数
 * @param totalSuccessful     成功文件数
 * @param totalPartial        部分成功文件数
 * @param totalFailed         失败文件数
 * @param totalDuplicates     检测到的重复文件数
 * @param duplicateFileNames  重复的文件名列表
 */
public record ReplayBatchSummary(
        int totalSubmitted,
        int totalSuccessful,
        int totalPartial,
        int totalFailed,
        int totalDuplicates,
        List<String> duplicateFileNames
) {
}
