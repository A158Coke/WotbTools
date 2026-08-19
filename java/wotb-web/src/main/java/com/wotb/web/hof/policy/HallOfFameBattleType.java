package com.wotb.web.hof.policy;

/**
 * 名人堂支持的战斗模式（业务归一值，与 DB hall_of_fame_record.battle_type 列值一致）。
 * raw meta.json#arenaBonusType → 归一模式；其余（训练房/联赛/娱乐/未知）→ {@link Optional#empty()}。
 */
public enum HallOfFameBattleType {

    RANDOM(1),
    RATING(7);

    private final int arenaBonusType;

    HallOfFameBattleType(final int arenaBonusType) {
        this.arenaBonusType = arenaBonusType;
    }

    /**
     * replay 中解析出的 authoritative raw integer。
     */
    public int arenaBonusType() {
        return arenaBonusType;
    }

    /**
     * raw arenaBonusType → 归一模式；未知/null/不支持 → empty。
     */
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
