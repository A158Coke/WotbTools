package com.wotb.core.processing;

/**
 * 回放类别无法映射为受支持的 AI 分析模式。
 */
public class UnsupportedReplayAnalysisModeException extends RuntimeException {
    public UnsupportedReplayAnalysisModeException(final String message) {
        super(message);
    }
}
