package com.wotb.contracts;

/** Provider-neutral object-storage key; it is not replay content or a provider URL. */
public record ObjectKey(String value) {
    public ObjectKey {
        value = ContractValues.required("objectKey", value);
    }
}
