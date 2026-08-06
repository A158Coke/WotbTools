package com.wotb.web.replay.ai.gateway;


/**
 * 供应商无关的 AI 聊天请求模型，由 Replay 业务层构造、交给 {@link AiChatGateway} 执行。
 * <p>不得携带任何 API key 或凭据；认证完全由 Gateway 实现负责。</p>
 *
 * @param systemPrompt      系统提示（必填非空）
 * @param userPrompt        用户提示（必填非空）
 * @param model             模型名（由调用方从配置注入；Gateway 仅转发）
 * @param temperature       采样温度，{@code null} 表示不发送该字段
 * @param maxOutputTokens   最大输出 token 数
 * @param thinkingEnabled   是否启用思考/推理模式
 * @param reasoningEffort   推理强度（如 "high"），仅在 {@code thinkingEnabled} 时有意义；可为 {@code null}
 * @param correlationId     关联/请求 ID，{@code null} 时由 Gateway 生成
 * @param analysisMode      分析模式标签（用于指标分维），如 {@code SINGLE_PLAYER_BATTLE}
 */
public record AiChatRequest(
        String systemPrompt,
        String userPrompt,
        String model,
        Double temperature,
        int maxOutputTokens,
        boolean thinkingEnabled,
        String reasoningEffort,
        String correlationId,
        String analysisMode
) {
    public AiChatRequest {
        if (systemPrompt == null) throw new IllegalArgumentException("systemPrompt must not be null");
        if (userPrompt == null) throw new IllegalArgumentException("userPrompt must not be null");
    }
}
