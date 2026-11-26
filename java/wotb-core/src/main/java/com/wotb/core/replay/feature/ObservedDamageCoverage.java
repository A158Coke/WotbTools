package com.wotb.core.replay.feature;

public final class ObservedDamageCoverage {

    private ObservedDamageCoverage() {
    }

    public static boolean matches(final int observedDealt,
                                  final int observedReceived,
                                  final int authoritativeDealt,
                                  final int authoritativeReceived) {
        return observedDealt == authoritativeDealt
                && observedReceived == authoritativeReceived;
    }
}
