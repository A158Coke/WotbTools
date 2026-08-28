package com.wotb.core.replay.event;

/**
 * Vehicle Type7 prop3 / method1 的原始 u16 HP/terminal 分类。
 *
 * <p>PR147 11.19 canonical：</p>
 * <ul>
 *   <li>positive signed i16 = actual current HP</li>
 *   <li>0x0000 = HP-zero terminal</li>
 *   <li>0xFFFD = death terminal sentinel</li>
 *   <li>0xFFFE = terminal only on the verified current-version chain</li>
 *   <li>0xFFFF = UNKNOWN, raw-preserved</li>
 * </ul>
 *
 * <p>HP 与 terminal/death 是独立事实；{@link #terminal()} 只表达已经闭合的 terminal
 * classification，不能反向推出“positive HP = alive”。</p>
 */
public enum HpRawState {
    CURRENT_HP(false),
    HP_ZERO_TERMINAL(true),
    DEATH_TERMINAL_FFFD(true),
    VERIFIED_TERMINAL_FFFE(true),
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
     * 对原始 u16 分类。0xFFFE 只有调用方已确认当前版本 verified chain 时才可升级为 terminal。
     */
    public static HpRawState classify(final int rawValue, final boolean allowFffeTerminal) {
        final int raw = rawValue & 0xFFFF;
        if (raw == 0x0000) {
            return HP_ZERO_TERMINAL;
        }
        if (raw == 0xFFFD) {
            return DEATH_TERMINAL_FFFD;
        }
        if (raw == 0xFFFE) {
            return allowFffeTerminal ? VERIFIED_TERMINAL_FFFE : UNKNOWN_OTHER;
        }
        if (raw == 0xFFFF) {
            return UNKNOWN_FFFF;
        }
        if ((short) raw > 0) {
            return CURRENT_HP;
        }
        return UNKNOWN_OTHER;
    }
}
