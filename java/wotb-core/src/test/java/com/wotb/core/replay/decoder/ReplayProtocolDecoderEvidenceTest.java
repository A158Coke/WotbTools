package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Decoder-facing regression for structural forward compatibility and closed semantic evidence. */
class ReplayProtocolDecoderEvidenceTest {

    @Test
    void structuralEvidenceMayReadFutureShape() {
        assertTrue(ReplayProtocolProfile.type10LayoutAllowed("11.22.0_china"));
        assertTrue(ReplayProtocolProfile.basicVehiclePropertiesAllowed("11.22.0_china"));
        assertTrue(ReplayProtocolProfile.methodLayoutAllowed("11.22.0_china"));
        assertTrue(ReplayProtocolProfile.positiveHpValueAllowed("11.22.0_china"));
    }

    @Test
    void closedSemanticsRemainUnknownWithoutEvidence() {
        assertFalse(ReplayProtocolProfile.closedSemanticsAllowed("11.22.0_china"));
        assertFalse(ReplayProtocolProfile.method36Allowed("11.22.0_china"));
        assertFalse(ReplayProtocolProfile.method38Allowed("11.22.0_china"));
        assertFalse(ReplayProtocolProfile.turretYawAllowed("11.22.0_china"));
        assertFalse(ReplayProtocolProfile.verifiedFffeTerminalAllowed("11.22.0_china"));
    }

    @Test
    void methodEvidenceIsScopedToMethodAndVersion() {
        assertTrue(ReplayProtocolProfile.methodSemanticAllowed("11.19.0_china", 29));
        assertTrue(ReplayProtocolProfile.methodSemanticAllowed("11.18.0_china", 1));
        assertFalse(ReplayProtocolProfile.methodSemanticAllowed("11.18.0_china", 29));
        assertFalse(ReplayProtocolProfile.methodSemanticAllowed("11.22.0_china", 1));
    }
}
