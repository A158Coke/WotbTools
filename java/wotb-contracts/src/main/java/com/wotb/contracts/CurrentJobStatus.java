package com.wotb.contracts;

/** Status vocabulary used by the current processing-job contract. */
public enum CurrentJobStatus {
    QUEUED,
    PROCESSING,
    READY,
    FAILED,
    CANCELLED
}
