package com.wotb.core.parse;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProtobufTest {

    @Test
    void decodesSupportedWireTypes() {
        final byte[] protobuf = {
                0x08, (byte) 0x96, 0x01,
                0x12, 0x02, 0x41, 0x42,
                0x1D, 0x04, 0x03, 0x02, 0x01
        };

        final Map<Integer, List<Object>> fields = Protobuf.decode(protobuf);

        assertEquals(150L, Protobuf.firstLong(fields, 1, 0));
        assertArrayEquals(new byte[]{0x41, 0x42}, (byte[]) Protobuf.first(fields, 2));
        assertEquals(0x01020304L, Protobuf.firstLong(fields, 3, 0));
    }

    @Test
    void rejectsLengthThatExceedsIntegerRangeBeforeAllocation() {
        final byte[] protobuf = {
                0x0A,
                (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, 0x0F
        };

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> Protobuf.decode(protobuf));

        assertTrue(error.getMessage().contains("length-delimited field exceeds integer range"));
    }

    @Test
    void rejectsLengthThatExceedsRemainingBytes() {
        final byte[] protobuf = {0x0A, 0x04, 0x01};

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> Protobuf.decode(protobuf));

        assertTrue(error.getMessage().contains("truncated length-delimited field"));
    }

    @Test
    void rejectsLengthThatExceedsBudgetBeforeAllocation() {
        final byte[] protobuf = {0x0A, (byte) 0x81, (byte) 0x80, (byte) 0x80, 0x04};

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> Protobuf.decode(protobuf));

        assertTrue(error.getMessage().contains("length-delimited field exceeds size limit"));
    }

    @Test
    void rejectsTruncatedFixedWidthField() {
        final byte[] protobuf = {0x0D, 0x01, 0x02};

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> Protobuf.decode(protobuf));

        assertTrue(error.getMessage().contains("truncated 32-bit field"));
    }

    @Test
    void rejectsVarintOverflow() {
        final byte[] varint = {
                (byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80,
                (byte) 0x80, (byte) 0x80, (byte) 0x80, (byte) 0x80, 0x02
        };

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> Protobuf.readVarint(varint, 0));

        assertTrue(error.getMessage().contains("varint overflow"));
    }

    @Test
    void rejectsFieldValueCountBeyondBudget() {
        final byte[] protobuf = new byte[(Protobuf.MAX_FIELD_VALUES + 1) * 2];
        for (int offset = 0; offset < protobuf.length; offset += 2) {
            protobuf[offset] = 0x08;
            protobuf[offset + 1] = 0x00;
        }

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> Protobuf.decode(protobuf));

        assertTrue(error.getMessage().contains("field value count exceeds limit"));
    }
}
