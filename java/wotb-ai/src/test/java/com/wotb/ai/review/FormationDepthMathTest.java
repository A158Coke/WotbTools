package com.wotb.ai.review;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FormationDepthMathTest {

    @Test
    void formatsSecondsToOneDecimalPlace() {
        assertEquals("1.2", FormationDepthMath.fmt(1.234));
        assertEquals("1.3", FormationDepthMath.fmt(1.25));
        assertEquals("0.0", FormationDepthMath.fmt(0.04));
    }
}
