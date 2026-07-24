package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 单个文件的统一解析结果。
 * 同时包含现有 Battle 解析结果 和 完整重建结果。
 *
 * @param capabilities        该文件的分析能力（AI 可分析性以战绩为准）
 * @param error               总体错误（解析致命失败/重复文件时）
 * @param reconstructionError 完整重建的错误（战绩成功但重建失败时保留，不被吞掉）
 */
public record ReplayProcessingResult(
        String fileName,
        ReplayProcessingStatus status,
        ReplayIdentity identity,
        Battle battle,
        ReplayReconstruction reconstruction,
        ReplayProcessingDiagnostics diagnostics,
        ReplayProcessingCapabilities capabilities,
        ReplayProcessingError error,
        ReplayProcessingError reconstructionError
) {

    /** 该文件是否可用于 AI 分析（以战绩这一权威源是否可用为准）。 */
    public boolean analyzable() {
        return capabilities != null && capabilities.recorderResultAvailable();
    }
}
