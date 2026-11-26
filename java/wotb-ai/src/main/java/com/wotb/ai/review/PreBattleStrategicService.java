package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class PreBattleStrategicService {

    private static final Logger LOGGER = LoggerFactory.getLogger(PreBattleStrategicService.class);

    static final int PRE_BATTLE_MAX_OUTPUT_TOKENS = 4096;

    static final int PRE_BATTLE_CALL_TIMEOUT_SEC = 45;

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final TankTacticalProfileRegistry profileRegistry;
    private final MapTacticalSemanticsRegistry mapSemanticsRegistry;
    private final MeterRegistry meterRegistry;

    @Autowired
    public PreBattleStrategicService(final AiChatGateway gateway,
                                     final AiReplayAnalysisConfig config,
                                     @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.gateway = gateway;
        this.config = config;
        this.profileRegistry = TankTacticalProfileRegistry.load();
        this.mapSemanticsRegistry = MapTacticalSemanticsRegistry.load();
        this.meterRegistry = meterRegistry;
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
