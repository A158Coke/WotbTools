package com.wotb.core.replay.facts;

/** Canonical HP observation source/kind. Terminal kinds preserve PR147 raw provenance. */
public enum HpObservationKind {
    CURRENT_HP,
    TERMINAL_ZERO,
    TERMINAL_FFFD,
    TERMINAL_FFFE,
    UNKNOWN_SENTINEL,
    MATERIALIZATION_HP,
    RECORDER_HP_MIRROR,
    METHOD1_HP
}
