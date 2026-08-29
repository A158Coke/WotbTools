package com.wotb.core.replay.processing;

/**
 * AI 分析模式。AI 复盘为单文件（{@code AiReplayBatchPolicy.MAX_FILES=1}），因此
 * 有效可分析单元数最多为 1，只会出现 NONE 或 SINGLE_*；MULTI_* 对应旧多文件
 * 批量分析，已随 multipart analyze（410）与 legacy 批量端点移除，不再产生。
 */
public enum ReplayAnalysisMode {
    NONE,
    SINGLE_PLAYER_BATTLE,
    SINGLE_TEAM_BATTLE
}
