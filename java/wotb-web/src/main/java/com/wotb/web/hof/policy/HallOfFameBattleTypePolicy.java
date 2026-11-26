package com.wotb.web.hof.policy;

import java.util.Optional;

public final class HallOfFameBattleTypePolicy {

    private HallOfFameBattleTypePolicy() {
    }

    public static Optional<HallOfFameBattleType> resolve(final Integer arenaBonusType) {
        return HallOfFameBattleType.resolve(arenaBonusType);
    }

    public static boolean isSupported(final Integer arenaBonusType) {
        return resolve(arenaBonusType).isPresent();
    }
}
