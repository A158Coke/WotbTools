package com.wotb.web.util;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/** Exact JSON numbers at request boundaries; rejects numeric strings and fractional values. */
public final class JsonNumberInputs {
    private JsonNumberInputs() { }

    public static class IntegerInput extends ValueDeserializer<Integer> {
        @Override
        public Integer deserialize(final JsonParser parser, final DeserializationContext context) {
            if (parser.hasToken(JsonToken.VALUE_NUMBER_INT)) { return parser.getIntValue(); }
            if (parser.hasToken(JsonToken.VALUE_NUMBER_FLOAT)) {
                try { return parser.getDecimalValue().intValueExact(); }
                catch (final ArithmeticException invalid) { return context.reportInputMismatch(Integer.class, "Expected an exact integer"); }
            }
            return context.reportInputMismatch(Integer.class, "Expected an integer JSON number");
        }
    }

    public static class LongInput extends ValueDeserializer<Long> {
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
}
