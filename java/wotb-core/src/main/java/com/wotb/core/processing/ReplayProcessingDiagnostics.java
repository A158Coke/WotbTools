package com.wotb.core.processing;

import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

/**
 * 单个文件的处理诊断信息。
 *
 * @param summaryParseSuccess 战绩解析是否成功
 * @param streamScanSuccess   事件流扫描是否完整
 * @param reconstructionSuccess 状态重建是否完成
 * @param diagnostics         事件流诊断（如有扫描）
 */
public record ReplayProcessingDiagnostics(
        boolean summaryParseSuccess,
        boolean streamScanSuccess,
        boolean reconstructionSuccess,
        ReplayStreamDiagnostics diagnostics
) {

    public static ReplayProcessingDiagnostics empty() {
        return new ReplayProcessingDiagnostics(false, false, false, null);
    }

    public static ReplayProcessingDiagnostics summaryOnly(boolean ok) {
        return new ReplayProcessingDiagnostics(ok, false, false, null);
    }
}
