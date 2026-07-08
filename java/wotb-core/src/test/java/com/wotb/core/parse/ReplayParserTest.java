package com.wotb.core.parse;

import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class ReplayParserTest {

    @Test
    void parseLongTreatsWhitespaceAsMissing() throws ReflectiveOperationException {
        final Method parseLong = ReplayParser.class.getDeclaredMethod("parseLong", String.class);
        parseLong.setAccessible(true);

        assertNull(invokeParseLong(parseLong, "   "));
        assertEquals(1719835200000L, invokeParseLong(parseLong, " 1719835200000 "));
    }

    private static Long invokeParseLong(final Method parseLong, final String value)
            throws InvocationTargetException, IllegalAccessException {
        return (Long) parseLong.invoke(null, value);
    }
}
