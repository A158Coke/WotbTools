package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Call #1 编排：构造 roster-only Prompt → 预算守卫 → 独立小输出上限的 LLM 调用
 * → 解析结构化 {@link PreBattleStrategicPrior}。
 * <p>任何失败（未配置 / 上游异常 / 解析失败）都返回 {@code null}，
 * 由 {@link TacticalReviewHarness} 决定降级，不让 Call #1 拖垮整场复盘。</p>
 */
@Service
public class PreBattleStrategicService {

    private static final Logger LOGGER = LoggerFactory.getLogger(PreBattleStrategicService.class);

    /** Call #1 是结构化 JSON，输出预算独立且远小于 Call #2。 */
    static final int PRE_BATTLE_MAX_OUTPUT_TOKENS = 4096;

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final TankTacticalProfileRegistry profileRegistry;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    public PreBattleStrategicService(final AiChatGateway gateway,
                                     final AiReplayAnalysisConfig config) {
        this.gateway = gateway;
        this.config = config;
        this.profileRegistry = TankTacticalProfileRegistry.load();
    }

    public boolean isConfigured() {
        return gateway.isConfigured();
    }

    /**
     * @return 解析成功的赛前战略基线；未配置 / 上游失败 / 解析失败返回 null。
     */
    public PreBattleStrategicPrior analyze(final Battle battle) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return null;
        }
        final String systemPrompt = PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT;
        final String userContent = PreBattlePromptBuilder.buildUserContent(battle, profileRegistry);
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent));
        try {
            AiPromptBudgetGuard.enforce(
                    config.estimator().estimateMessagesTokens(messages),
                    config.singleReplayMaxInputTokens(),
                    config.contextWindowTokens(),
                    PRE_BATTLE_MAX_OUTPUT_TOKENS,
                    config.promptSafetyMarginTokens());
        } catch (final IllegalArgumentException e) {
            LOGGER.warn("Pre-battle prompt exceeds budget, skipping Call #1: {}", e.getMessage());
            return null;
        }

        final AiChatRequest request = new AiChatRequest(
                systemPrompt,
                userContent,
                config.model(),
                null,
                PRE_BATTLE_MAX_OUTPUT_TOKENS,
                config.thinkingEnabled(),
                config.reasoningEffort(),
                null,
                "PRE_BATTLE_STRATEGIC_PRIOR");
        final PreBattleStrategicPrior prior;
        try {
            prior = PreBattleStrategicParser.parse(gateway.chat(request).completionText());
        } catch (final RuntimeException e) {
            LOGGER.warn("Pre-battle Call #1 failed, skipping: {}", e.getMessage());
            if (meterRegistry != null) {
                meterRegistry.counter("wotb_ai_review_prebattle_total", "result", "failure").increment();
            }
            return null;
        }
        if (prior == null || !prior.hasContent()) {
            LOGGER.info("Pre-battle Call #1 returned unparsable/empty prior, skipping");
            if (meterRegistry != null) {
                meterRegistry.counter("wotb_ai_review_prebattle_total", "result", "unparsable").increment();
            }
            return null;
        }
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_prebattle_total", "result", "success").increment();
        }
        return prior;
    }
}
