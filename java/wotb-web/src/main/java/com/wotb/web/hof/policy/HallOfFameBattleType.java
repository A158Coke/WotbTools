package com.wotb.web.hof.policy;

public enum HallOfFameBattleType {

    RANDOM(1),
    RATING(7);

    private final int arenaBonusType;

    HallOfFameBattleType(final int arenaBonusType) {
        this.arenaBonusType = arenaBonusType;
    }

    public int arenaBonusType() {
        return arenaBonusType;
    }

    public static java.util.Optional<HallOfFameBattleType> resolve(final Integer raw) {
        if (raw == null) {
            return java.util.Optional.empty();
        }
        for (final HallOfFameBattleType type : values()) {
            if (type.arenaBonusType == raw) {
                return java.util.Optional.of(type);
            }
        }
        return java.util.Optional.empty();
    }
}
