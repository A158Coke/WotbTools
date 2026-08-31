package com.wotb.contracts;

/**
 * Future async-domain lifecycle. This enum must not be exposed by the current Web/Android DTOs;
 * use the Web module's explicit CurrentProcessingStatusAdapter at the migration boundary.
 */
public enum JobStatus {
    QUEUED,
    PROCESSING,
    SUCCEEDED,
    FAILED,
    CANCELLED
}
