package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
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
 * 由 {@link TacticalReviewHarness} 决定降级，不让 Call #1 拖垮整场复盘。
 * 结构化 JSON 小调用强制关闭 thinking：DeepSeek thinking 模式（effort=max）会把
 * 整个输出预算消耗在 reasoning 上并返回空正文（线上实测 AI_EMPTY_RESPONSE），
 * 关闭后直接输出契约 JSON（finish_reason=stop）。</p>
 */
@Service
public class PreBattleStrategicService {

    private static final Logger LOGGER = LoggerFactory.getLogger(PreBattleStrategicService.class);

    /** Call #1 是结构化 JSON，输出预算独立且远小于 Call #2。 */
    static final int PRE_BATTLE_MAX_OUTPUT_TOKENS = 4096;

    /** Call #1 是小型 roster/map JSON 分析，必须有独立、明显更短的调用预算。 */
    static final int PRE_BATTLE_CALL_TIMEOUT_SEC = 45;

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final TankTacticalProfileRegistry profileRegistry;
    private final MapTacticalSemanticsRegistry mapSemanticsRegistry;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    public PreBattleStrategicService(final AiChatGateway gateway,
                                     final AiReplayAnalysisConfig config) {
        this.gateway = gateway;
        this.config = config;
        this.profileRegistry = TankTacticalProfileRegistry.load();
        this.mapSemanticsRegistry = MapTacticalSemanticsRegistry.load();
    }

    public boolean isConfigured() {
        return gateway.isConfigured();
    }

    /**
     * 执行赛前战略基线 Call #1，真实发起调用前/后广播 {@code call1_start} /
     * {@code call1_done} 阶段事件。
     *
     * @return 解析成功的赛前战略基线；未配置 / 上游失败 / 解析失败返回 null。
     */
    public PreBattleStrategicPrior analyze(final Battle battle,
                                           final AiReviewStreamListener listener) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return null;
        }
        final String systemPrompt = PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT;
        final MapTacticalSemantics semantics =
                mapSemanticsRegistry.semanticsFor(battle.mapName);
        final String userContent = PreBattlePromptBuilder.buildUserContent(
                battle, profileRegistry, semantics);
        logInputCoverage(battle, semantics);
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
                // 结构化 JSON 任务：关闭 thinking，避免 reasoning 吃光 4096 输出预算
                // 导致空正文（AI_EMPTY_RESPONSE），见类 Javadoc。
                false,
                null,
                null,
                "PRE_BATTLE_STRATEGIC_PRIOR",
                PRE_BATTLE_CALL_TIMEOUT_SEC);
        listener.onStage("call1_start");
        final PreBattleStrategicPrior prior;
        try {
            prior = PreBattleStrategicParser.parse(gateway.chat(request).completionText());
        } catch (final RuntimeException e) {
            LOGGER.warn("Pre-battle Call #1 failed, skipping: {}", e.getMessage());
            if (meterRegistry != null) {
                meterRegistry.counter("wotb_ai_review_prebattle_total", "result", "failure").increment();
            }
            return null;
        } finally {
            listener.onStage("call1_done");
        }
        if (prior == null || !prior.hasContent()) {
            LOGGER.info("Pre-battle Call #1 returned unparsable/empty prior, skipping");
            if (meterRegistry != null) {
                meterRegistry.counter("wotb_ai_review_prebattle_total", "result", "unparsable").increment();
            }
            return null;
        }
        LOGGER.info("Pre-battle Call #1 success: hypotheses={} matchups={} winConditions={} "
                        + "teamA(strengths={},plans={}) teamB(strengths={},plans={})",
                prior.hypotheses().size(),
                prior.keyMatchups().size(),
                prior.strategicWinConditions().size(),
                prior.teamA() == null ? 0 : prior.teamA().strengths().size(),
                prior.teamA() == null ? 0 : prior.teamA().preferredPlans().size(),
                prior.teamB() == null ? 0 : prior.teamB().strengths().size(),
                prior.teamB() == null ? 0 : prior.teamB().preferredPlans().size());
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_prebattle_total", "result", "success").increment();
        }
        return prior;
    }

    /** 可观测：记录 Call #1 输入覆盖（地图语义状态 + 车辆战术 Profile 覆盖率），供 Loki/Grafana 验证。 */
    private void logInputCoverage(final Battle battle,
                                  final MapTacticalSemantics semantics) {
        final boolean found = semantics != null && semantics.hasSemantics();
        int team1 = 0;
        int team2 = 0;
        int curatedProfiles = 0;
        int fallbackProfiles = 0;
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p == null) {
                    continue;
                }
                if (p.team == 1) {
                    team1++;
                } else if (p.team == 2) {
                    team2++;
                }
                final TankTacticalProfile profile = profileRegistry.profileFor(
                        p.tankId,
                        p.tankName,
                        ReplayDisplayNames.tankClass(p.tankId),
                        ReplayDisplayNames.tankTier(p.tankId));
                if (profile.curated()) {
                    curatedProfiles++;
                } else {
                    fallbackProfiles++;
                }
            }
        }
        LOGGER.info("Pre-battle Call #1 input: map={} mapSemantics={} verified={} areas={} "
                        + "relationships={} spawnSemantics={} source={} displayName={} "
                        + "team1={} team2={} curatedProfiles={} fallbackProfiles={}",
                battle.mapName,
                found ? "found" : "UNKNOWN",
                found && semantics.verified(),
                found ? semantics.areas().size() : 0,
                found ? semantics.relationships().size() : 0,
                found ? semantics.spawnSemantics().size() : 0,
                found && !semantics.source().isBlank() ? semantics.source() : "",
                found && !semantics.displayName().isBlank() ? semantics.displayName() : "",
                team1,
                team2,
                curatedProfiles,
                fallbackProfiles);
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_map_semantics_total",
                    "status", found ? "found" : "unknown").increment();
        }
    }
}
