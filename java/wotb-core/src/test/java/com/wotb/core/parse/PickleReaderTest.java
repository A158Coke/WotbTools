package com.wotb.core.parse;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PickleReaderTest {

    @Test
    void parsesExpectedTuple() {
        final byte[] pickle = {
                (byte) 0x80, 0x04,
                'K', 42,
                'C', 0x02, 0x01, 0x02,
                (byte) 0x86,
                '.'
        };

        final Object[] tuple = assertInstanceOf(Object[].class, PickleReader.loads(pickle));

        assertEquals(42L, tuple[0]);
        assertArrayEquals(new byte[]{0x01, 0x02}, assertInstanceOf(byte[].class, tuple[1]));
    }

    @Test
    void parsesFramedProtocolFourTuple() {
        final byte[] pickle = {
                (byte) 0x80, 0x04,
                (byte) 0x95, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                (byte) 0x8A, 0x08, 0x43, 0x3A, 0x35, 0x6A, (byte) 0xB4, (byte) 0xEE, 0x1F, 0x10,
                0x43, 0x02, 0x18, 0x01,
                (byte) 0x94, (byte) 0x86, (byte) 0x94, 0x2E
        };

        final Object[] tuple = assertInstanceOf(Object[].class, PickleReader.loads(pickle));

        assertEquals(1161909687528274499L, tuple[0]);
        assertArrayEquals(new byte[]{0x18, 0x01}, assertInstanceOf(byte[].class, tuple[1]));
    }

    @Test
    void rejectsUnsignedFourByteLengthBeforeAllocation() {
        final byte[] pickle = {'B', (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF};

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> PickleReader.loads(pickle));

        assertTrue(error.getMessage().contains("BINBYTES length exceeds integer range"));
    }

    @Test
    void rejectsUnsignedEightByteLengthBeforeAllocation() {
        final byte[] pickle = {
                (byte) 0x8e,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, (byte) 0x80
        };

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> PickleReader.loads(pickle));

        assertTrue(error.getMessage().contains("BINBYTES8 length exceeds integer range"));
    }

    @Test
    void rejectsTruncatedBinaryPayload() {
        final byte[] pickle = {'B', 0x04, 0x00, 0x00, 0x00, 0x01, '.'};

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> PickleReader.loads(pickle));

        assertTrue(error.getMessage().contains("truncated BINBYTES"));
    }

    @Test
    void rejectsTextLengthBeyondBudgetBeforeAllocation() {
        final byte[] pickle = {'X', 0x01, 0x00, 0x10, 0x00};

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> PickleReader.loads(pickle));

        assertTrue(error.getMessage().contains("BINUNICODE length exceeds limit"));
    }

    @Test
    void rejectsFrameLongerThanRemainingInput() {
        final byte[] pickle = {
                (byte) 0x95,
                0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                '.'
        };

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> PickleReader.loads(pickle));

        assertTrue(error.getMessage().contains("truncated FRAME"));
    }

    @Test
    void rejectsStackGrowthBeyondBudget() {
        final byte[] pickle = new byte[PickleReader.MAX_STACK_ITEMS + 2];
        Arrays.fill(pickle, 0, pickle.length - 1, (byte) ')');
        pickle[pickle.length - 1] = '.';

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> PickleReader.loads(pickle));

        assertTrue(error.getMessage().contains("stack size exceeds limit"));
    }
}
