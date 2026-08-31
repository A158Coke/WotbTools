package com.wotb.core.replay.processing;

/**
 * AI single-result eligibility（PR-E：从 {@code BatchAnalyzer} 解耦）。
 *
 * <p>只做单文件 scope/eligibility 判定，不引入 batch / group / representative / status framework。
 * 消费方直接对单个 {@link ReplayProcessingResult} 判定；可用时优先用 result-based 重载
 * （它按当前 result 对象直接判定，不缓存可从 battle/reconstruction/team resolution 廉价重算的状态）。</p>
 */
public final class AiAnalysisEligibility {

    private AiAnalysisEligibility() {
    }

    /** scope-aware eligibility from the processed-result capability facts. */
    public static boolean isAiAnalyzable(final ReplayProcessingCapabilities caps,
                                         final ReplayAnalysisScope scope) {
        if (caps == null || scope == null) {
            return false;
        }
        return switch (scope) {
            case PLAYER_FOCUSED -> caps.summaryAvailable() && caps.recorderResultAvailable();
            case TEAM_PERSPECTIVE -> caps.summaryAvailable()
                    && caps.perspectiveTeamResolved()
                    && (caps.recorderResultAvailable()
                            || caps.teamFeatureExtractionPossible());
        };
    }

    /** scope-aware eligibility from a single processing result (non-{@code null} capability facts). */
    public static boolean isAiAnalyzable(final ReplayProcessingResult result,
                                         final ReplayAnalysisScope scope) {
        return isAiAnalyzable(result != null ? result.capabilities() : null, scope);
    }
}
