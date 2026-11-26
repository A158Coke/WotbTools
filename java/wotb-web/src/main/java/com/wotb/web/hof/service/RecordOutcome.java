package com.wotb.web.hof.service;

public enum RecordOutcome {

    SAVED(null),
    ATTACHED(null),
    IDEMPOTENT(null),
    SKIPPED_UNSUPPORTED_BATTLE_TYPE("UNSUPPORTED_BATTLE_TYPE"),
    SKIPPED_UNKNOWN_RECORDER("DUPLICATE_OR_UNKNOWN_RECORDER"),
    SKIPPED_HASH_CONFLICT("REPLAY_HASH_CONFLICT");

    private final String reasonCode;

    RecordOutcome(final String reasonCode) {
        this.reasonCode = reasonCode;
    }

    public boolean isSkipped() {
        return reasonCode != null;
    }

    public String getReasonCode() {
        return reasonCode;
    }
}
