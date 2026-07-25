package com.wotb.core.replay.feature;

/**
 * Team Feature 的事实覆盖率。
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
        int ignoredOutOfBoundsPositionEventCount,
        int ignoredInvalidTimestampEventCount,
        double decodedPacketRatio,
        boolean fullFeaturesAvailable
) {

    public static TeamFeatureCoverage empty() {
        return new TeamFeatureCoverage(
                false, false, false, 0, 0, 0, 0,
                0, 0, 0, 0, 0.0, false);
    }
}
