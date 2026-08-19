package com.wotb.web.replay.ai;

import java.util.Map;

import com.wotb.core.ai.EvidenceDensity;

/**
 * Player Replay Prompt 与确定性证据构建结果，由 {@link PlayerReplayPromptBuilder}
 * 一次性产出，供 {@code AiReplayAnalysisService} 做 token 预算检查后交给
 * {@code AiChatGateway}。
 *
 * <p>不含 Spring AI 类型；不携带 API key 或任何 {@code Map<String,Object>} 请求体。</p>
 *
 * @param systemPrompt         系统 prompt（来自 {@link PlayerReplayPromptBuilder} 的常量）
 * @param userPrompt           用户 prompt（后端确定性证据拼接产物，已按 token 预算密度裁剪）
 * @param analysisMode         分析模式标签（用于上游指标分维），如 {@code SINGLE_PLAYER_BATTLE}
 * @param density              证据密度等级（仅完整特征路径有意义；fallback/multi 给 {@link EvidenceDensity#LEVEL_1_COMPRESSED}）
 * @param estimatedInputTokens 由 token estimator 估算的本 prompt 输入 token 数（用于日志）
 */
public record PreparedAiPrompt(
        String systemPrompt,
        String userPrompt,
        String analysisMode,
        EvidenceDensity density,
        int estimatedInputTokens
) {
    public PreparedAiPrompt {
        if (systemPrompt == null) {
            throw new IllegalArgumentException("systemPrompt must not be null");
        }
        if (userPrompt == null) {
            throw new IllegalArgumentException("userPrompt must not be null");
        }
    }
}
