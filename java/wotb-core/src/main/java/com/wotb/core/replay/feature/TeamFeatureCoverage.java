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

    public static TeamFeatureCoverage empty() {
        return new TeamFeatureCoverage(
                false, false, false, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0.0, false);
    }
}
