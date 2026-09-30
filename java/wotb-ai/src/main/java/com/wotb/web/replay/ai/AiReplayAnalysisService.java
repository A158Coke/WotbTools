package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 兼容 facade：保持 Controller / Review Service / 现有测试的公共入口不变，
 * 委托给 {@link PlayerReplayAnalysisService} 与 {@link TeamReplayAnalysisService}。
 * <p>本类不构建 Prompt、不发送 HTTP、不处理 Provider DTO、不含大型业务算法。
 * 所有真实编排已移出；统计/分区/预算/拼装均下沉到对应组件。</p>
 */
@Service
public class AiReplayAnalysisService {

    private final PlayerReplayAnalysisService playerService;
    private final TeamReplayAnalysisService teamService;

    @Autowired
    public AiReplayAnalysisService(final PlayerReplayAnalysisService playerService,
                                   final TeamReplayAnalysisService teamService) {
        this.playerService = playerService;
        this.teamService = teamService;
    }

    /**
     * 测试用包级构造器：在没有 Spring 容器时直接由 Gateway + 4 个核心预算字段组装
     * Player/Team Service 与共享 {@link AiReplayAnalysisConfig}。contextWindow/
     * maxOutput/safety/thinking/reasoning 使用与默认构造相同的内置值。
     */
    AiReplayAnalysisService(final AiChatGateway gateway,
                            final String model,
                            final int singleReplayMaxInputTokens,
                            final AiTokenEstimator tokenEstimator) {
        this(gateway, model, singleReplayMaxInputTokens, tokenEstimator,
                131072, 8192, 1000, true, "high");
    }

    private AiReplayAnalysisService(final AiChatGateway gateway,
                                    final String model,
                                    final int singleReplayMaxInputTokens,
                                    final AiTokenEstimator tokenEstimator,
                                    final int contextWindowTokens,
                                    final int maxOutputTokens,
                                    final int promptSafetyMarginTokens,
                                    final boolean call2ThinkingEnabled,
                                    final String reasoningEffort) {
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                tokenEstimator, model,
                Math.max(1, singleReplayMaxInputTokens),
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens,
                call2ThinkingEnabled, reasoningEffort, 315, 4096);
        this.playerService = new PlayerReplayAnalysisService(gateway, config);
        this.teamService = new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                new TeamAutopsyService(gateway, config, null),
                System::nanoTime,
                null);
    }

    public boolean isConfigured() {
        return playerService.isConfigured();
    }

    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon) {
        return analyze(battle, recon, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon,
                                 final AllowedLanguage language) {
        return playerService.analyze(battle, recon, language);
    }

    /** 兼容 facade 转发；{@code analyzePlayerContext} 非 production AI Review entrypoint（见 PlayerReplayAnalysisService）。 */
    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx) {
        return analyzePlayerContext(ctx, AllowedLanguage.ZH);
    }

    /** 兼容 facade 转发；{@code analyzePlayerContext} 非 production AI Review entrypoint（见 PlayerReplayAnalysisService）。 */
    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final AllowedLanguage language) {
        return playerService.analyzePlayerContext(ctx, language);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                             final ReplayReconstruction recon) {
        return analyzePlayerContext(ctx, recon, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final ReplayReconstruction recon,
                                              final AllowedLanguage language) {
        return playerService.analyzePlayerContext(ctx, recon, language);
    }

    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context) {
        return analyzeSingleTeamContext(context, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context,
                                                  final AllowedLanguage language) {
        return teamService.analyzeSingleTeamContext(context, language);
    }

    public TeamAnalyzeResult analyzeTeam(final Battle battle, final ReplayReconstruction reconstruction,
                                         final AllowedLanguage language,
                                         final AiReviewStreamListener listener) {
        return teamService.analyzeTeam(battle, reconstruction, language, listener);
    }
}
