package com.wotb.contracts;

/** Opaque idempotency/event identifier. */
public record EventId(String value) {
    public EventId {
        value = ContractValues.required("eventId", value);
    }
}
