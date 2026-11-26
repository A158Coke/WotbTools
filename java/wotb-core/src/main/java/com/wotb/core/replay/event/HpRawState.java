package com.wotb.core.replay.event;

public enum HpRawState {
    CURRENT_HP(false),
    HP_ZERO_TERMINAL(true),
    DEATH_TERMINAL_FFFD(true),
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

    public static HpRawState fromWireName(final String name) {
        if (name == null) {
            return null;
        }
        return switch (name) {
            case "CURRENT_HP" -> CURRENT_HP;
            case "HP_ZERO_TERMINAL" -> HP_ZERO_TERMINAL;
            case "DEATH_TERMINAL_FFFD" -> DEATH_TERMINAL_FFFD;
            case "DEATH_TERMINAL" -> DEATH_TERMINAL;
            case "UNKNOWN_FFFF" -> UNKNOWN_FFFF;
            case "UNKNOWN_OTHER" -> UNKNOWN_OTHER;
            default -> null;
        };
    }

    public static HpRawState fromProjection(final String name, final int rawValue) {
        final HpRawState mapped = fromWireName(name);
        return mapped != null ? mapped : classify(rawValue);
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
