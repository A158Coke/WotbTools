package com.wotb.contracts;

/** Immutable identity of one replay source within a processing job. */
public record ReplayProcessingSource(int sourceIndex, String sourceName) {

    public ReplayProcessingSource {
        if (sourceIndex < 0) {
            throw new IllegalArgumentException("sourceIndex must not be negative");
        }
        sourceName = ContractValues.required("sourceName", sourceName);
    }
}
