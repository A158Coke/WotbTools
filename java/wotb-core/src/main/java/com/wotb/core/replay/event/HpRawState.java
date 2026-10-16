package com.wotb.core.replay.event;

/** Vehicle Type7 prop3 / method1 的原始 u16 HP/terminal 分类。 */
public enum HpRawState {
    CURRENT_HP(false),
    HP_ZERO_TERMINAL(true),
    DEATH_TERMINAL_FFFD(true),
    /** 客户端投影携带的权威终态（投影 `hpState = DEATH_TERMINAL`，负 i16 哨兵全族）。 */
    DEATH_TERMINAL(true),
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
    /**
     * 投影载荷携带的 canonical 分类（`hpState`）→ 本枚举。**字段在场 = 权威**（不重新分类 raw）；
     * 缺省（旧载荷）回退 {@link #classify(int)} 的 legacy 语义（仅 0/0xFFFD 终态，−1/−2 未知）。
     * 未知名由调用方在信任边界拒绝（{@code ClientAiProjectionAdapter} 的 require），本方法只兜底
     * 已注册名与 null。
     */
    public static HpRawState fromProjection(final String name, final int rawValue) {
        if (name != null) {
            for (final HpRawState state : values()) {
                if (state.name().equals(name)) {
                    return state;
                }
            }
        }
        return classify(rawValue);
    }

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
