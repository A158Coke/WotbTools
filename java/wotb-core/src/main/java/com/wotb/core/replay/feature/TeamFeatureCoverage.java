package com.wotb.core.replay.feature;

/**
 * Team Feature coverage statistics.
 * observedPositionEventCount includes both VALID and CLAMPED positions.
 * clampedPositionEventCount is a subset of observedPositionEventCount.
 * ignoredOutOfBoundsPositionEventCount and INVALID positions are NOT included
 * in observedPositionEventCount.
 */
public record TeamFeatureCoverage(
        boolean authoritativeSummaryAvailable,
        boolean reconstructionAvailable,
        boolean streamComplete,
        int authoritativeMemberCount,
        int mappedMemberCount,
        int observedPositionEventCount,
        int observedDamageEventCount,
        int unattributedDamageEventCount,
        int unattributedPositionEventCount,
        int nonCombatantPositionEventCount,
        int clampedPositionEventCount,
        int ignoredOutOfBoundsPositionEventCount,
        int ignoredInvalidTimestampEventCount,
        double decodedPacketRatio,
        boolean fullFeaturesAvailable
) {

    public TeamFeatureCoverage {
        if (observedPositionEventCount < 0) {
            throw new IllegalArgumentException(
                    "observedPositionEventCount must be >= 0: " + observedPositionEventCount);
        }
        if (clampedPositionEventCount < 0) {
            throw new IllegalArgumentException(
                    "clampedPositionEventCount must be >= 0: " + clampedPositionEventCount);
        }
        // CLAMPED positions are a strict subset of observed positions.
        if (clampedPositionEventCount > observedPositionEventCount) {
            throw new IllegalArgumentException(
                    "clampedPositionEventCount " + clampedPositionEventCount
                            + " > observedPositionEventCount " + observedPositionEventCount);
        }
        if (unattributedPositionEventCount < 0) {
            throw new IllegalArgumentException(
                    "unattributedPositionEventCount must be >= 0: " + unattributedPositionEventCount);
        }
        if (ignoredOutOfBoundsPositionEventCount < 0) {
            throw new IllegalArgumentException(
                    "ignoredOutOfBoundsPositionEventCount must be >= 0: "
                            + ignoredOutOfBoundsPositionEventCount);
        }
        if (ignoredInvalidTimestampEventCount < 0) {
            throw new IllegalArgumentException(
                    "ignoredInvalidTimestampEventCount must be >= 0: "
                            + ignoredInvalidTimestampEventCount);
        }
    }

    /**
     * AI-visible 渲染：排除 internal-only 的 {@code nonCombatantPositionEventCount}。
     * PR #103 §6：non-#301 实体（观战/镜头/场景对象）位置对战术无影响，不得进入 LLM prompt；
     * 该计数保留在字段供后端 metrics / probe / debug。
     */
    @Override
    public String toString() {
        return "TeamFeatureCoverage[authoritativeSummaryAvailable=" + authoritativeSummaryAvailable
                + ", reconstructionAvailable=" + reconstructionAvailable
                + ", streamComplete=" + streamComplete
                + ", authoritativeMemberCount=" + authoritativeMemberCount
                + ", mappedMemberCount=" + mappedMemberCount
                + ", observedPositionEventCount=" + observedPositionEventCount
                + ", observedDamageEventCount=" + observedDamageEventCount
                + ", unattributedDamageEventCount=" + unattributedDamageEventCount
                + ", unattributedPositionEventCount=" + unattributedPositionEventCount
                + ", clampedPositionEventCount=" + clampedPositionEventCount
                + ", ignoredOutOfBoundsPositionEventCount=" + ignoredOutOfBoundsPositionEventCount
                + ", ignoredInvalidTimestampEventCount=" + ignoredInvalidTimestampEventCount
                + ", decodedPacketRatio=" + decodedPacketRatio
                + ", fullFeaturesAvailable=" + fullFeaturesAvailable + "]";
    }

    public static TeamFeatureCoverage empty() {
        return new TeamFeatureCoverage(
                false, false, false, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0.0, false);
    }
}
