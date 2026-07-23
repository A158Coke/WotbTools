package com.wotb.core.processing;

/** 不支持的 AI 分析模式（如团队视角尚未实现）。 */
public class UnsupportedReplayAnalysisModeException extends RuntimeException {
    public UnsupportedReplayAnalysisModeException(String message) {
        super(message);
    }
}
