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
     * 对原始 u16 分类（PR147 前向兼容版本门禁）。
     *
     * <p>0xFFFD / 0xFFFE 是 version-scoped 特殊 numeric semantic：只有调用方确认该 client version
     * 已 verified（{@code fffdVerified}/{@code fffeVerified}）时才升级为 terminal；未来未认证版本必须
     * raw-preserve 为 {@link #UNKNOWN_OTHER}，绝不继承 11.19 的 terminal 含义。正 HP 与 0x0000 是
     * structural 值，任何结构与 envelope 兼容的版本都可安全解释。</p>
     */
    public static HpRawState classify(final int rawValue, final boolean fffdVerified,
                                      final boolean fffeVerified) {
        final int raw = rawValue & 0xFFFF;
        if (raw == 0x0000) {
            return HP_ZERO_TERMINAL;
        }
        if (raw == 0xFFFD) {
            return fffdVerified ? DEATH_TERMINAL_FFFD : UNKNOWN_OTHER;
        }
        if (raw == 0xFFFE) {
            return fffeVerified ? VERIFIED_TERMINAL_FFFE : UNKNOWN_OTHER;
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
