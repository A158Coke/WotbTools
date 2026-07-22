package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 单个文件的统一解析结果。
 * 同时包含现有 Battle 解析结果 和 完整重建结果。
 */
public record ReplayProcessingResult(
        String fileName,
        ReplayProcessingStatus status,
        ReplayIdentity identity,
        Battle battle,
        ReplayReconstruction reconstruction,
        ReplayProcessingDiagnostics diagnostics,
        ReplayProcessingError error
) {

    /** 该文件是否可用于 AI 分析（SUCCESS 或 PARTIAL_SUCCESS）。 */
    public boolean analyzable() {
        return status == ReplayProcessingStatus.SUCCESS
                || status == ReplayProcessingStatus.PARTIAL_SUCCESS;
    }
}
