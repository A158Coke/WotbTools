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
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Team Autopsy（第 3 次调用）：判负 → 战犯（≥1），判胜 → MVP（≥1）。
 * <p>输入 = 权威结算 + Call #1 职责基线 + 关键窗口；stage budget 由 Harness 按整体剩余预算
 * 计算（上限 30s），失败/解析失败返回 {@code null}，由 Harness 决定不输出团队剖析段，不影响主复盘。
 * {@code AI_CANCELLED} 必须重新抛出（不能被吞掉）。</p>
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
     * @param winner           通过显式 recorderTeam 计算的胜负（Prompt 与渲染共用同一值）
     * @param callTimeoutSec   Call #3 的 stage budget（已由 Harness 按整体剩余预算裁剪）
     * @return 结构化结果 + 本方 roster；DRAW / 非法队伍 / 非 ZH / 预算不足 / 调用或解析失败 → null
     */
    public TeamAutopsyOutcome analyze(final Battle battle,
                                      final PreBattleStrategicPrior prior,
                                      final EvidenceSkillResult evidence,
                                      final Long recorderAccountId,
                                      final int recorderTeam,
                                      final AllowedLanguage language,
                                      final Winner winner,
                                      final int callTimeoutSec) {
        if (language != AllowedLanguage.ZH) {
            return null;
        }
        if (winner == null || winner == Winner.DRAW_OR_UNKNOWN
                || !com.wotb.core.processing.PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return null;
        }
        if (callTimeoutSec <= 0) {
            count("budget_exhausted");
            return null;
        }
        final List<TeamAutopsyStats> allStats = new TeamAutopsyStatsBuilder().build(
                battle,
                evidence != null ? evidence.criticalWindows() : List.of(),
                recorderTeam,
                recorderAccountId);
        if (allStats.isEmpty()) {
            return null;
        }

        final String systemPrompt = TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT;
        final String userContent = TeamAutopsyPromptBuilder.buildUserContent(
                allStats, prior,
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
                callTimeoutSec);
        try {
            final TeamAutopsyResult result =
                    TeamAutopsyParser.parse(
                            gateway.chat(request).completionText(),
                            playerKeys(allStats),
                            winner);
            if (result == null) {
                count("unparsable");
                return null;
            }
            count("success");
            return new TeamAutopsyOutcome(result, allStats);
        } catch (final AiUpstreamException e) {
            if ("AI_CANCELLED".equals(e.code())) {
                throw e;
            }
            LOGGER.warn("Team autopsy call failed, skipping section: {}", e.getMessage());
            count("failure");
            return null;
        } catch (final RuntimeException e) {
            LOGGER.warn("Team autopsy call failed, skipping section: {}", e.getMessage());
            count("failure");
            return null;
        }
    }

    private static Set<String> playerKeys(final List<TeamAutopsyStats> stats) {
        return stats.stream()
                .map(TeamAutopsyStats::playerKey)
                .collect(Collectors.toSet());
    }

    private void count(final String result) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_team_autopsy_total", "result", result)
                    .increment();
        }
    }
}
