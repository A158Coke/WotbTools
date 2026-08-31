package com.wotb.contracts;

/**
 * Snapshot of statuses currently used by the public processing/source contracts. PENDING is kept
 * for source-level/current DTO variants; this type is an adapter input, not a replacement DTO.
 */
public enum CurrentProcessingStatus {
    PENDING,
    QUEUED,
    PROCESSING,
    READY,
    FAILED,
    CANCELLED
}
