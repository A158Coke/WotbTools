package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
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
 * Team Autopsy（team perspective 结算级 TEAM_AUTOPSY）：判负 → 战犯（≥1），判胜 → MVP（≥1）。
 * <p>输入 = 权威逐人结算（无 Strategic Prior / Critical Window / Route 证据），
 * 使用结算级 system prompt，LLM 判断的 confidence 仅允许 PARTIAL/UNKNOWN；
 * 仅当 recorderTeam 恰好存在 7 名有效本方玩家时才生成 P1..P7 并调用 Gateway，
 * 0..6 人或超过 7 人时跳过并记录 roster_incomplete。
 * TEAM_AUTOPSY stage budget 上限 30s，实际值由 {@link TeamReplayAnalysisService}
 * 按整体剩余预算裁剪；失败/解析失败返回 {@code null}，不影响团队复盘。
 * {@code AI_CANCELLED} 必须重新抛出（不能被吞掉）。
 * 结构化 JSON 小调用强制关闭 thinking：DeepSeek thinking 模式（effort=max）会把
 * 整个输出预算消耗在 reasoning 上并返回空正文（线上实测 AI_EMPTY_RESPONSE），
 * 关闭后直接输出契约 JSON（finish_reason=stop）。</p>
 */
@Service
public class TeamAutopsyService {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamAutopsyService.class);

    /** Team Autopsy 输入为 7 人权威结算；TEAM_AUTOPSY stage budget 上限（秒），
     *  实际值由编排器按整体剩余预算裁剪（min(30s, 剩余 - margin)）。 */
    static final int AUTOPSY_CALL_TIMEOUT_SEC = 30;
    static final int AUTOPSY_MAX_OUTPUT_TOKENS = 2048;

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final MeterRegistry meterRegistry;

    @Autowired
    public TeamAutopsyService(final AiChatGateway gateway,
                              final AiReplayAnalysisConfig config,
                              @Autowired(required = false) final MeterRegistry meterRegistry) {
        this.gateway = gateway;
        this.config = config;
        this.meterRegistry = meterRegistry;
    }

    /**
     * @param winner           通过显式 recorderTeam 计算的胜负（Prompt 与渲染共用同一值）
     * @param callTimeoutSec   TEAM_AUTOPSY 的 stage budget（已由编排器按整体剩余预算裁剪）
     * @return 结构化结果 + 本方 roster；DRAW / 非法队伍 / 非 ZH / 预算不足 / 调用或解析失败 → null
     */
    public TeamAutopsyOutcome analyze(final Battle battle,
                                      final ReplayReconstruction recon,
                                      final int recorderTeam,
                                      final AllowedLanguage language,
                                      final TeamBattleWinner winner,
                                      final String teamLabel,
                                      final int callTimeoutSec) {
        return analyze(battle, recon, recorderTeam, language, winner, teamLabel, callTimeoutSec,
                AiReviewStreamListener.NOOP);
    }

    /**
     * 同 {@link #analyze}，但真实发起 TEAM_AUTOPSY 调用前/后广播
     * {@code autopsy_start} / {@code autopsy_done} 阶段事件。
     */
    public TeamAutopsyOutcome analyze(final Battle battle,
                                      final ReplayReconstruction recon,
                                      final int recorderTeam,
                                      final AllowedLanguage language,
                                      final TeamBattleWinner winner,
                                      final String teamLabel,
                                      final int callTimeoutSec,
                                      final AiReviewStreamListener listener) {
        if (language != AllowedLanguage.ZH) {
            return null;
        }
        if (winner == null || winner.winner() == Winner.DRAW_OR_UNKNOWN
                || !com.wotb.core.processing.PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return null;
        }
        if (callTimeoutSec <= 0) {
            count("budget_exhausted");
            return null;
        }
        final List<TeamAutopsyStats> allStats = new TeamAutopsyStatsBuilder().build(
                battle,
                List.of(),
                recorderTeam,
                null);
        if (allStats.size() != 7) {
            LOGGER.info("Team autopsy skipped: friendly roster has {} players, expected 7",
                    allStats.size());
            count("roster_incomplete");
            return null;
        }

        final String systemPrompt = TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT_SETTLEMENT_ONLY;
        final String userContent = TeamAutopsyPromptBuilder.buildUserContent(
                allStats, null,
                List.of(),
                winner,
                teamLabel,
                battle,
                recon,
                recorderTeam);
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
                // 结构化 JSON 任务：关闭 thinking，避免 reasoning 吃光 2048 输出预算
                // 导致空正文（AI_EMPTY_RESPONSE），见类 Javadoc。
                false,
                null,
                null,
                "TEAM_AUTOPSY",
                callTimeoutSec);
        listener.onStage("autopsy_start");
        try {
            final TeamAutopsyResult result =
                    TeamAutopsyParser.parse(
                            gateway.chat(request).completionText(),
                            playerKeys(allStats),
                            winner.winner());
            if (result == null) {
                count("unparsable");
                return null;
            }
            LOGGER.info("Team autopsy success: liabilities={} mvps={}",
                    result.biggestLiabilities().size(), result.mvps().size());
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
        } finally {
            listener.onStage("autopsy_done");
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
