package com.wotb.contracts;

/** Opaque batch identifier; transport and persistence adapters own its encoding. */
public record BatchId(String value) {
    public BatchId {
        value = ContractValues.required("batchId", value);
    }
}
