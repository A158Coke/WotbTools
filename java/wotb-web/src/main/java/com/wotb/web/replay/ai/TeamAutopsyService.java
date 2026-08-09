package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import com.wotb.core.replay.feature.TeamAutopsyStatsBuilder;
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
 * Team Autopsy（第 3 次调用）：判负 → 战犯（≥1），判胜 → MVP（≥1）。
 * <p>输入 = 权威结算 + Call #1 职责基线 + 关键窗口；使用独立小 stage budget（30s），
 * 失败/解析失败返回 {@code null}，由 Harness 决定不输出团队剖析段，不影响主复盘。</p>
 */
@Service
public class TeamAutopsyService {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamAutopsyService.class);

    /** Team Autopsy 输入很小（7 人结算 + 基线 + 窗口摘要），独立 stage budget。 */
    static final int AUTOPSY_CALL_TIMEOUT_SEC = 30;
    static final int AUTOPSY_MAX_OUTPUT_TOKENS = 2048;

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    public TeamAutopsyService(final AiChatGateway gateway,
                              final AiReplayAnalysisConfig config) {
        this.gateway = gateway;
        this.config = config;
    }

    /**
     * @return 结构化结果；DRAW / 非 ZH / 非本方无数据 / 调用或解析失败 → null
     */
    public TeamAutopsyResult analyze(final Battle battle,
                                     final PreBattleStrategicPrior prior,
                                     final EvidenceSkillResult evidence,
                                     final Long recorderAccountId,
                                     final int recorderTeam,
                                     final AllowedLanguage language) {
        if (language != AllowedLanguage.ZH) {
            return null;
        }
        // recorderTeam 由调用方显式提供，不依赖 battle.recorder 推断
        final Winner winner = FriendlyEnemyResult.resolve(battle.winnerTeam, recorderTeam);
        if (winner == Winner.DRAW_OR_UNKNOWN) {
            return null;
        }
        final List<TeamAutopsyStats> allStats = new TeamAutopsyStatsBuilder().build(
                battle,
                evidence != null ? evidence.criticalWindows() : List.of(),
                recorderAccountId);
        final List<TeamAutopsyStats> teamStats = allStats.stream()
                .filter(s -> s.team() == recorderTeam)
                .toList();
        if (teamStats.isEmpty()) {
            return null;
        }

        final String systemPrompt = TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT;
        final String userContent = TeamAutopsyPromptBuilder.buildUserContent(
                battle, teamStats, prior,
                evidence != null ? evidence.criticalWindows() : List.of(),
                winner);
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent));
        try {
            AiPromptBudgetGuard.enforce(
                    config.estimator().estimateMessagesTokens(messages),
                    config.singleReplayMaxInputTokens(),
                    config.contextWindowTokens(),
                    AUTOPSY_MAX_OUTPUT_TOKENS,
                    config.promptSafetyMarginTokens());
        } catch (final IllegalArgumentException e) {
            LOGGER.warn("Team autopsy prompt exceeds budget, skipping: {}", e.getMessage());
            count("budget");
            return null;
        }

        final AiChatRequest request = new AiChatRequest(
                systemPrompt,
                userContent,
                config.model(),
                null,
                AUTOPSY_MAX_OUTPUT_TOKENS,
                config.thinkingEnabled(),
                config.reasoningEffort(),
                null,
                "TEAM_AUTOPSY",
                AUTOPSY_CALL_TIMEOUT_SEC);
        try {
            final TeamAutopsyResult result =
                    TeamAutopsyParser.parse(gateway.chat(request).completionText());
            count(result != null ? "success" : "unparsable");
            return result;
        } catch (final RuntimeException e) {
            LOGGER.warn("Team autopsy call failed, skipping section: {}", e.getMessage());
            count("failure");
            return null;
        }
    }

    private void count(final String result) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_team_autopsy_total", "result", result)
                    .increment();
        }
    }
}
