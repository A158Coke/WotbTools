package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DecodeConfidenceHelperTest {

    @Test
    void exactOrdinalZero() {
        assertEquals(0, DecodeConfidenceHelper.ordinal(DecodeConfidence.EXACT));
    }

    @Test
    void inferredOrdinalOne() {
        assertEquals(1, DecodeConfidenceHelper.ordinal(DecodeConfidence.INFERRED));
    }

    @Test
    void partialOrdinalTwo() {
        assertEquals(2, DecodeConfidenceHelper.ordinal(DecodeConfidence.PARTIAL));
    }

    @Test
    void unknownOrdinalThree() {
        assertEquals(3, DecodeConfidenceHelper.ordinal(DecodeConfidence.UNKNOWN));
    }

    @Test
    void exactNotLowConfidence() {
        assertFalse(DecodeConfidenceHelper.isLowConfidence(DecodeConfidence.EXACT));
    }

    @Test
    void inferredNotLowConfidence() {
        assertFalse(DecodeConfidenceHelper.isLowConfidence(DecodeConfidence.INFERRED));
    }

    @Test
    void partialIsLowConfidence() {
        assertTrue(DecodeConfidenceHelper.isLowConfidence(DecodeConfidence.PARTIAL));
    }

    @Test
    void unknownIsLowConfidence() {
        assertTrue(DecodeConfidenceHelper.isLowConfidence(DecodeConfidence.UNKNOWN));
    }

    @Test
    void nullIsLowConfidence() {
        assertTrue(DecodeConfidenceHelper.isLowConfidence(null));
    }

    @Test
    void ordinalOrder() {
        assertTrue(DecodeConfidenceHelper.ordinal(DecodeConfidence.EXACT)
                < DecodeConfidenceHelper.ordinal(DecodeConfidence.INFERRED));
        assertTrue(DecodeConfidenceHelper.ordinal(DecodeConfidence.INFERRED)
                < DecodeConfidenceHelper.ordinal(DecodeConfidence.PARTIAL));
        assertTrue(DecodeConfidenceHelper.ordinal(DecodeConfidence.PARTIAL)
                < DecodeConfidenceHelper.ordinal(DecodeConfidence.UNKNOWN));
    }
}
