package com.wotb.web.replay.ai;

import java.util.List;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 兼容 facade：保持 Controller / Review Service / 现有测试的公共入口不变，
 * 委托给 {@link PlayerReplayAnalysisService} 与 {@link TeamReplayAnalysisService}。
 * <p>本类不构建 Prompt、不发送 HTTP、不处理 Provider DTO、不含大型业务算法。
 * 所有真实编排已移出；统计/分区/预算/拼装均下沉到对应组件。</p>
 * <p>静态方法 {@link #buildAnalysisUnits}、{@link #findRecorder} 委托给
 * {@link AnalysisUnitAssembler} 以保持原有公共契约。</p>
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
                                    final boolean thinkingEnabled,
                                    final String reasoningEffort) {
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                tokenEstimator, model,
                Math.max(1, singleReplayMaxInputTokens),
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens,
                thinkingEnabled, reasoningEffort);
        this.playerService = new PlayerReplayAnalysisService(gateway, config);
        this.teamService = new TeamReplayAnalysisService(gateway, config);
    }

    public boolean isConfigured() {
        return playerService.isConfigured();
    }

    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon) {
        return analyze(battle, recon, OutputLanguage.ZH);
    }

    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon,
                                 final OutputLanguage language) {
        return playerService.analyze(battle, recon, language);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx) {
        return analyzePlayerContext(ctx, OutputLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final OutputLanguage language) {
        return playerService.analyzePlayerContext(ctx, language);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                             final ReplayReconstruction recon) {
        return analyzePlayerContext(ctx, recon, OutputLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final ReplayReconstruction recon,
                                              final OutputLanguage language) {
        return playerService.analyzePlayerContext(ctx, recon, language);
    }

    public AnalyzeResult analyzeMulti(final List<Battle> battles) {
        return analyzeMulti(battles, OutputLanguage.ZH);
    }

    public AnalyzeResult analyzeMulti(final List<Battle> battles,
                                      final OutputLanguage language) {
        return playerService.analyzeMulti(battles, language);
    }

    public AnalyzeResult analyzePlayerOrFallback(final ReplayProcessingResult result) {
        return analyzePlayerOrFallback(result, OutputLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerOrFallback(final ReplayProcessingResult result,
                                                 final OutputLanguage language) {
        return playerService.analyzePlayerOrFallback(result, language);
    }

    public SingleTeamBattleAnalysisContext buildSingleTeamContext(
            final ReplayPerspectiveGroup group) {
        return teamService.buildSingleTeamContext(group);
    }

    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context) {
        return analyzeSingleTeamContext(context, OutputLanguage.ZH);
    }

    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context,
                                                  final OutputLanguage language) {
        return teamService.analyzeSingleTeamContext(context, language);
    }

    public TeamAnalyzeResult analyzeTeamGroups(final List<ReplayPerspectiveGroup> groups) {
        return analyzeTeamGroups(groups, OutputLanguage.ZH);
    }

    public TeamAnalyzeResult analyzeTeamGroups(final List<ReplayPerspectiveGroup> groups,
                                               final OutputLanguage language) {
        return teamService.analyzeTeamGroups(groups, language);
    }

    /**
     * 委托 {@link AnalysisUnitAssembler#buildAnalysisUnits} 以保持原有静态公共契约。
     */
    public static List<com.wotb.core.processing.AnalysisUnitResult> buildAnalysisUnits(
            final List<ReplayPerspectiveGroup> groups,
            final ReplayAnalysisScope scope) {
        return AnalysisUnitAssembler.buildAnalysisUnits(groups, scope);
    }

    /**
     * 委托 {@link AnalysisUnitAssembler#findRecorder} 以保持原有静态公共契约。
     */
    public static RecorderEntityMapping findRecorder(final ReplayProcessingResult rep) {
        return AnalysisUnitAssembler.findRecorder(rep);
    }
}
