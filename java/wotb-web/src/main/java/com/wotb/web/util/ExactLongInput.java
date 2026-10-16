package com.wotb.web.util;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/** JSON integer transport input; rejects fractional numbers and numeric strings. */
public final class ExactLongInput extends ValueDeserializer<Long> {
    @Override
    public Long deserialize(final JsonParser parser, final DeserializationContext context) {
        if (parser.hasToken(JsonToken.VALUE_NUMBER_INT)) { return parser.getLongValue(); }
        if (parser.hasToken(JsonToken.VALUE_NUMBER_FLOAT)) {
            try { return parser.getDecimalValue().longValueExact(); }
            catch (final ArithmeticException invalid) { return context.reportInputMismatch(Long.class, "Expected an exact integer"); }
        }
        return context.reportInputMismatch(Long.class, "Expected an integer JSON number");
    }
}
