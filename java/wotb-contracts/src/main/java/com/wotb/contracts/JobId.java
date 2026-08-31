package com.wotb.contracts;

/** Opaque future-worker job identifier. */
public record JobId(String value) {
    public JobId {
        value = ContractValues.required("jobId", value);
    }
}
