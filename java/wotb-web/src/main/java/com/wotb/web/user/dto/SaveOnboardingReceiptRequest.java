package com.wotb.web.user.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import tools.jackson.databind.JsonNode;

/** Strict JSON shape at the HTTP boundary; terminal/epoch business validation belongs to the service. */
public record SaveOnboardingReceiptRequest(int coreEpoch, String disposition) {

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SaveOnboardingReceiptRequest fromJson(final JsonNode value) {
        if (value == null || !value.isObject() || value.size() != 2
                || !value.has("coreEpoch") || !value.has("disposition")) {
            throw new IllegalArgumentException("INVALID_REQUEST");
        }
        final JsonNode epoch = value.get("coreEpoch");
        final JsonNode disposition = value.get("disposition");
        if (!epoch.isNumber() || !disposition.isString()) {
            throw new IllegalArgumentException("INVALID_REQUEST");
        }
        try {
            return new SaveOnboardingReceiptRequest(epoch.decimalValue().intValueExact(), disposition.asString());
        } catch (final ArithmeticException invalid) {
            throw new IllegalArgumentException("INVALID_REQUEST", invalid);
        }
    }
}
