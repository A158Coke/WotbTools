package com.wotb.contracts;

final class ContractValues {
    private ContractValues() {
    }

    static String required(final String name, final String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
