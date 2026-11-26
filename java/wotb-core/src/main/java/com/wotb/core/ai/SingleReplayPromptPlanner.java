package com.wotb.core.ai;

import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class SingleReplayPromptPlanner {

    private final AiTokenEstimator tokenEstimator;
    private final int singleReplayMaxInputTokens;
    private final int contextWindowTokens;
    private final int maxOutputTokens;
    private final int promptSafetyMarginTokens;

    private static final double UPGRADE_THRESHOLD = 0.90;
    private static final int POSITION_SAMPLE_INTERVAL_SEC = 2;
    private static final int KEY_WINDOW_HALF_WIDTH_SEC = 5;

    public SingleReplayPromptPlanner(
            final AiTokenEstimator tokenEstimator,
            final int singleReplayMaxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens
    ) {
        this.tokenEstimator = tokenEstimator;
        if (singleReplayMaxInputTokens <= 0) {
            throw new IllegalArgumentException("singleReplayMaxInputTokens must be positive: " + singleReplayMaxInputTokens);
        }
        if (contextWindowTokens <= 0) {
            throw new IllegalArgumentException("contextWindowTokens must be positive: " + contextWindowTokens);
        }
        if (maxOutputTokens <= 0) {
            throw new IllegalArgumentException("maxOutputTokens must be positive: " + maxOutputTokens);
        }
        if (promptSafetyMarginTokens < 0) {
            throw new IllegalArgumentException("promptSafetyMarginTokens must be non-negative: " + promptSafetyMarginTokens);
        }
        this.singleReplayMaxInputTokens = singleReplayMaxInputTokens;
        this.contextWindowTokens = contextWindowTokens;
        this.maxOutputTokens = maxOutputTokens;
        this.promptSafetyMarginTokens = promptSafetyMarginTokens;
    }

    /**
     * 执行证据密度规划。
     *
     * @param systemPrompt    系统提示词
     * @param baseUserContent 基础用户内容（mandatory + 压缩 features）
     * @param ctx             单场分析上下文
     * @param recon           回放重建结果（可为 null，此时仅返回基础内容）
     * @return 规划结果
     */
    public PlannedPrompt plan(
            final String systemPrompt,
            final String baseUserContent,
            final SinglePlayerBattleAnalysisContext ctx,
            final ReplayReconstruction recon
    ) {
        Objects.requireNonNull(systemPrompt, "systemPrompt must not be null");
        Objects.requireNonNull(baseUserContent, "baseUserContent must not be null");
        Objects.requireNonNull(ctx, "ctx must not be null");

        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            final int baseTokens = estimateTotalTokens(systemPrompt, baseUserContent);
            return new PlannedPrompt(
                    baseUserContent,
                    baseTokens,
                    effectiveInputLimit(),
                    EvidenceDensity.LEVEL_1_COMPRESSED,
                    false,
                    "No reconstruction data; using LEVEL_1_COMPRESSED"
            );
        }

        final int effectiveLimit = effectiveInputLimit();
        final int baseTokens = estimateTotalTokens(systemPrompt, baseUserContent);

        if (baseTokens > effectiveLimit) {
            return new PlannedPrompt(
                    baseUserContent,
                    baseTokens,
                    effectiveLimit,
                    EvidenceDensity.LEVEL_1_COMPRESSED,
                    true,
                    "Base content exceeds limit; truncated"
            );
        }

        String currentContent = baseUserContent;
        int currentTokens = baseTokens;
        EvidenceDensity currentDensity = EvidenceDensity.LEVEL_1_COMPRESSED;
        final int upgradeThreshold = (int) (effectiveLimit * UPGRADE_THRESHOLD);

        final Float battleStartRawClockSec = recon.battleStartRawClockSec();
        final boolean battleStartAvailable = battleStartRawClockSec != null
                && Float.isFinite(battleStartRawClockSec)
                && battleStartRawClockSec > 0f;

        if (!battleStartAvailable) {
            currentContent += "\n\n[LIMITATION] BATTLE_RELATIVE_TIME_UNAVAILABLE: Cannot align feature timestamps with raw clock; skipping detailed evidence levels.";
            currentTokens = estimateTotalTokens(systemPrompt, currentContent);
        }

        if (battleStartAvailable && currentTokens < upgradeThreshold) {
            final String level2Content = PlannerLevelEvidence.buildLevel2PositionSample(recon, ctx, battleStartRawClockSec);
            if (!level2Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level2Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_2_POSITION_SAMPLE;
                }
            }
        }

        if (battleStartAvailable && currentTokens < upgradeThreshold && currentDensity.ordinal() >= EvidenceDensity.LEVEL_2_POSITION_SAMPLE.ordinal()) {
            final String level3Content = PlannerLevelEvidence.buildLevel3ObservedTimeline(recon, ctx, battleStartRawClockSec);
            if (!level3Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level3Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_3_OBSERVED_TIMELINE;
                }
            }
        }

        if (battleStartAvailable && currentTokens < upgradeThreshold && currentDensity.ordinal() >= EvidenceDensity.LEVEL_3_OBSERVED_TIMELINE.ordinal()) {
            final String level4Content = PlannerLevelEvidence.buildLevel4KeyWindowPrecision(recon, ctx, battleStartRawClockSec);
            if (!level4Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level4Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_4_KEY_WINDOW_HIGH_PRECISION;
                }
            }
        }

        if (battleStartAvailable && currentTokens < upgradeThreshold && currentDensity.ordinal() >= EvidenceDensity.LEVEL_4_KEY_WINDOW_HIGH_PRECISION.ordinal()) {
            final String level5Content = PlannerLevelEvidence.buildLevel5EventLevel(recon, ctx, battleStartRawClockSec);
            if (!level5Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level5Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_5_EVENT_LEVEL;
                }
            }
        }

        final boolean truncated = baseTokens > effectiveLimit;
        final String summary = String.format(
                "density=%s baseTokens=%d finalTokens=%d effectiveLimit=%d",
                currentDensity, baseTokens, currentTokens, effectiveLimit
        );

        return new PlannedPrompt(
                currentContent,
                currentTokens,
                effectiveLimit,
                currentDensity,
                truncated,
                summary
        );
    }



    static String buildLevel2PositionSample(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec) {
        return PlannerLevelEvidence.buildLevel2PositionSample(recon, ctx, battleStartRawClockSec);
    }

    static String buildLevel3ObservedTimeline(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec) {
        return PlannerLevelEvidence.buildLevel3ObservedTimeline(recon, ctx, battleStartRawClockSec);
    }

    static String buildLevel4KeyWindowPrecision(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec) {
        return PlannerLevelEvidence.buildLevel4KeyWindowPrecision(recon, ctx, battleStartRawClockSec);
    }

    static String buildLevel5EventLevel(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec) {
        return PlannerLevelEvidence.buildLevel5EventLevel(recon, ctx, battleStartRawClockSec);
    }


    private int effectiveInputLimit() {
        final int fromContextWindow = contextWindowTokens - maxOutputTokens - promptSafetyMarginTokens;
        return Math.clamp(fromContextWindow, 0, singleReplayMaxInputTokens);
    }

    private int estimateTotalTokens(final String systemPrompt, final String userContent) {
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent)
        );
        return tokenEstimator.estimateMessagesTokens(messages);
    }

}
