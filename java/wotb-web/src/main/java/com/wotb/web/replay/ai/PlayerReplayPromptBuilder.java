package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.List;

/**
 * Player Replay 的 prompt 构建入口（facade）。
 * <p>提供 prepareFallback / prepareFullNoRecon / prepareFull / prepareMulti 公开入口与
 * buildPlayerContextSummary / buildSummary 等测试入口；实际实现已拆分到
 * {@link PlayerPromptRules}（规则/多语言/system prompt）、{@link PlayerEvidenceFormatter}（证据格式化）
 * 与 {@link PlayerSummaryBuilder}（prepare* 编排与摘要构建）。</p>
 */
public final class PlayerReplayPromptBuilder {

    private PlayerReplayPromptBuilder() {
    }

    // ===== 规则与多语言：常量与 localize 已迁至 PlayerPromptRules，此处保留测试引用入口 =====

    static final String COMMON_TANK_PROPER_NOUN_RULE = PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE;

    static final String SYSTEM_PROMPT = PlayerPromptRules.SYSTEM_PROMPT;

    static final String SINGLE_PLAYER_PROMPT = PlayerPromptRules.SINGLE_PLAYER_PROMPT;

    static final String MULTI_SYSTEM_PROMPT = PlayerPromptRules.MULTI_SYSTEM_PROMPT;

    static String localizePlayerSystemPrompt(final String zhPrompt, final AllowedLanguage language) {
        return PlayerPromptRules.localizePlayerSystemPrompt(zhPrompt, language);
    }

    // ===== prepare* 编排：新逻辑在 PlayerSummaryBuilder，此处保留公开入口 =====

    public static PreparedAiPrompt prepareFallback(final Battle battle,
                                                   final ReplayReconstruction recon) {
        return PlayerSummaryBuilder.prepareFallback(battle, recon);
    }

    public static PreparedAiPrompt prepareFallback(final Battle battle,
                                                   final ReplayReconstruction recon,
                                                   final AllowedLanguage language) {
        return PlayerSummaryBuilder.prepareFallback(battle, recon, language);
    }

    public static PreparedAiPrompt prepareFullNoRecon(
            final SinglePlayerBattleAnalysisContext ctx,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens) {
        return PlayerSummaryBuilder.prepareFullNoRecon(ctx, estimator, maxInputTokens,
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens);
    }

    public static PreparedAiPrompt prepareFullNoRecon(
            final SinglePlayerBattleAnalysisContext ctx,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens,
            final AllowedLanguage language) {
        return PlayerSummaryBuilder.prepareFullNoRecon(ctx, estimator, maxInputTokens,
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens, language);
    }

    public static PreparedAiPrompt prepareFull(
            final SinglePlayerBattleAnalysisContext ctx,
            final ReplayReconstruction recon,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens) {
        return PlayerSummaryBuilder.prepareFull(ctx, recon, estimator, maxInputTokens,
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens);
    }

    public static PreparedAiPrompt prepareFull(
            final SinglePlayerBattleAnalysisContext ctx,
            final ReplayReconstruction recon,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens,
            final AllowedLanguage language) {
        return PlayerSummaryBuilder.prepareFull(ctx, recon, estimator, maxInputTokens,
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens, language);
    }

    public static PreparedAiPrompt prepareMulti(final List<Battle> battles) {
        return PlayerSummaryBuilder.prepareMulti(battles);
    }

    public static PreparedAiPrompt prepareMulti(final List<Battle> battles,
                                                final AllowedLanguage language) {
        return PlayerSummaryBuilder.prepareMulti(battles, language);
    }

    public static String buildPlayerContextSummary(final SinglePlayerBattleAnalysisContext ctx) {
        return PlayerSummaryBuilder.buildPlayerContextSummary(ctx);
    }

    static String buildSummary(final Battle battle, final ReplayReconstruction recon,
                               final List<KeyBattleEvent> keyEvents) {
        return PlayerSummaryBuilder.buildSummary(battle, recon, keyEvents);
    }

    static boolean appendRecorderDamageExchange(final StringBuilder sb,
                                                final Battle battle,
                                                final PlayerResult rec) {
        return PlayerEvidenceFormatter.appendRecorderDamageExchange(sb, battle, rec);
    }

    static boolean appendDamageExchangeByOpponent(final StringBuilder sb,
                                                  final Battle battle,
                                                  final long recorderAccountId,
                                                  final ReplayReconstruction recon) {
        return PlayerEvidenceFormatter.appendDamageExchangeByOpponent(sb, battle, recorderAccountId, recon);
    }

    static boolean appendPerHitDamageEvents(final StringBuilder sb,
                                            final Battle battle,
                                            final long recorderAccountId,
                                            final ReplayReconstruction recon) {
        return PlayerEvidenceFormatter.appendPerHitDamageEvents(sb, battle, recorderAccountId, recon);
    }

    static boolean appendKillAttribution(final StringBuilder sb,
                                         final Battle battle,
                                         final PlayerResult rec) {
        return PlayerEvidenceFormatter.appendKillAttribution(sb, battle, rec);
    }

    static void appendPlayerLine(final StringBuilder sb, final PlayerResult p, final boolean isFriendly) {
        PlayerEvidenceFormatter.appendPlayerLine(sb, p, isFriendly);
    }

    static void appendPlayerLine(final StringBuilder sb, final PlayerResult p,
                                 final boolean isFriendly, final boolean isYou) {
        PlayerEvidenceFormatter.appendPlayerLine(sb, p, isFriendly, isYou);
    }

    static void appendDeathTimeline(final StringBuilder sb, final Battle battle) {
        PlayerEvidenceFormatter.appendDeathTimeline(sb, battle);
    }

    static void appendRecorderMovementEvidence(final StringBuilder sb,
                                               final List<MovementSegment> movements,
                                               final String mapCode) {
        PlayerEvidenceFormatter.appendRecorderMovementEvidence(sb, movements, mapCode);
    }

}
