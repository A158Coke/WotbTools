package com.wotb.core.replay.feature;

public record TeamFeatureCoverage(
        boolean authoritativeSummaryAvailable,
        boolean reconstructionAvailable,
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
        Double decodedPacketRatio,
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

    @Override
    public String toString() {
        return "TeamFeatureCoverage[authoritativeSummaryAvailable=" + authoritativeSummaryAvailable
                + ", reconstructionAvailable=" + reconstructionAvailable
                + ", authoritativeMemberCount=" + authoritativeMemberCount
                + ", mappedMemberCount=" + mappedMemberCount
                + ", observedPositionEventCount=" + observedPositionEventCount
                + ", observedDamageEventCount=" + observedDamageEventCount
                + ", unattributedDamageEventCount=" + unattributedDamageEventCount
                + ", unattributedPositionEventCount=" + unattributedPositionEventCount
                + ", clampedPositionEventCount=" + clampedPositionEventCount
                + ", ignoredOutOfBoundsPositionEventCount=" + ignoredOutOfBoundsPositionEventCount
                + ", ignoredInvalidTimestampEventCount=" + ignoredInvalidTimestampEventCount
                + ", decodedPacketRatio=" + (decodedPacketRatio == null ? "UNAVAILABLE" : decodedPacketRatio)
                + ", fullFeaturesAvailable=" + fullFeaturesAvailable + "]";
    }

    public static TeamFeatureCoverage empty() {
        return new TeamFeatureCoverage(
                false, false, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, null, false);
    }
}
