package com.wotb.core.replay.event;

/** Vehicle Type7 prop3 / method1 的原始 u16 HP/terminal 分类。 */
public enum HpRawState {
    CURRENT_HP(false),
    HP_ZERO_TERMINAL(true),
    DEATH_TERMINAL_FFFD(true),
    UNKNOWN_FFFF(false),
    UNKNOWN_OTHER(false);

    private final boolean terminal;

    HpRawState(final boolean terminal) {
        this.terminal = terminal;
    }

    public boolean terminal() {
        return terminal;
    }

    /**
     * 对原始 u16 分类。FFFD 是已证明的 death terminal；无法证明的 sentinel 保留 raw/UNKNOWN。
     * 正 HP 与 0x0000 的解释只依赖其 wire shape，不依赖 clientVersion。
     */
    public static HpRawState classify(final int rawValue) {
        final int raw = rawValue & 0xFFFF;
        if (raw == 0x0000) {
            return HP_ZERO_TERMINAL;
        }
        if (raw == 0xFFFD) {
            return DEATH_TERMINAL_FFFD;
        }
        if (raw == 0xFFFF) {
            return UNKNOWN_FFFF;
        }
        if (raw == 0xFFFE) {
            return UNKNOWN_OTHER;
        }
        if ((short) raw > 0) {
            return CURRENT_HP;
        }
        return UNKNOWN_OTHER;
    }
}
