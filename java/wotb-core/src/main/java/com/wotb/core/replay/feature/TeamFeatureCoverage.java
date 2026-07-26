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
        int clampedPositionEventCount,
        int ignoredOutOfBoundsPositionEventCount,
        int ignoredInvalidTimestampEventCount,
        double decodedPacketRatio,
        boolean fullFeaturesAvailable
) {

    public static TeamFeatureCoverage empty() {
        return new TeamFeatureCoverage(
                false, false, false, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0.0, false);
    }
}
