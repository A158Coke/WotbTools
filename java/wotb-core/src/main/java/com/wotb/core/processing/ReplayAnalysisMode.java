package com.wotb.core.processing;

/**
 * AI 分析模式，由后端根据可分析回放数量自动确定。
 */
public enum ReplayAnalysisMode {
    /** 无可分析回放 */
    NONE,

    /** 只有 1 个可分析回放 */
    SINGLE_BATTLE,

    /** 2 个及以上可分析回放 */
    MULTI_BATTLE;

    public static ReplayAnalysisMode resolve(int analyzableCount) {
        if (analyzableCount <= 0) return NONE;
        if (analyzableCount == 1) return SINGLE_BATTLE;
        return MULTI_BATTLE;
    }
}
