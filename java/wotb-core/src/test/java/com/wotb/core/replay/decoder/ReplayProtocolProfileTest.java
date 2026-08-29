package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** PR162/P1-6：per-capability 11.18 evidence matrix —— 非 blanket「family → all VERIFIED」。 */
class ReplayProtocolProfileTest {

    @Test
    void currentFamilyVerifiesAllCapabilities() {
        for (final ReplayProtocolProfile.Capability c : ReplayProtocolProfile.Capability.values()) {
            assertEquals(ReplayProtocolProfile.Level.VERIFIED,
                    ReplayProtocolProfile.levelOf("11.19.0_china_apple", c),
                    "11.19 current family: " + c);
        }
    }

    @Test
    void legacyFamilyVerifiesOnlyEvidenceBasedStructuralCapabilities() {
        // 11.18 有独立 evidence（PR147 corpus 11.18/11.19 + research/fixture/test）→ VERIFIED
        for (final ReplayProtocolProfile.Capability c : new ReplayProtocolProfile.Capability[]{
                ReplayProtocolProfile.Capability.TYPE10_LAYOUT,
                ReplayProtocolProfile.Capability.ENTITY_PROPERTY_ENVELOPE,
                ReplayProtocolProfile.Capability.ENTITY_METHOD_ENVELOPE,
                ReplayProtocolProfile.Capability.ENTITY_LIFECYCLE_LAYOUT,
                ReplayProtocolProfile.Capability.PARTICIPANT_MAPPING,
                ReplayProtocolProfile.Capability.TYPE14_STREAM_CLOSE,
                ReplayProtocolProfile.Capability.SETTLEMENT_SCHEMA,
                ReplayProtocolProfile.Capability.HP_POSITIVE_VALUE,
                ReplayProtocolProfile.Capability.PROP_TURRET_YAW,
                ReplayProtocolProfile.Capability.TERMINAL_FFFD,
                ReplayProtocolProfile.Capability.ENTITY_TYPE_ID_SEMANTIC}) {
            assertEquals(ReplayProtocolProfile.Level.VERIFIED,
                    ReplayProtocolProfile.levelOf("11.18.0_china_apple", c), "11.18 evidence: " + c);
        }
    }

    @Test
    void legacyFamilyDoesNotInheritClosedNumericSemantics() {
        // 无独立 11.18 evidence 的闭式数值语义 → UNKNOWN（不因 family 自动 VERIFIED）
        for (final ReplayProtocolProfile.Capability c : new ReplayProtocolProfile.Capability[]{
                ReplayProtocolProfile.Capability.TERMINAL_FFFE,
                ReplayProtocolProfile.Capability.METHOD_SEMANTICS,
                ReplayProtocolProfile.Capability.METHOD36_AIM_RAY,
                ReplayProtocolProfile.Capability.METHOD38_SHOT_RESULT,
                ReplayProtocolProfile.Capability.TYPE31_GUN_MARKER,
                ReplayProtocolProfile.Capability.TYPE35_SESSION_DECISECOND,
                ReplayProtocolProfile.Capability.AMMO_SELECTION}) {
            assertEquals(ReplayProtocolProfile.Level.UNKNOWN,
                    ReplayProtocolProfile.levelOf("11.18.0_china_apple", c),
                    "11.18 无独立 evidence 的闭式语义必须 fail-closed: " + c);
        }
    }

    @Test
    void futureFamilyKeepsStructuralOnlyAndClosedUnknown() {
        assertEquals(ReplayProtocolProfile.Level.STRUCTURALLY_COMPATIBLE,
                ReplayProtocolProfile.levelOf("11.22.0_china", ReplayProtocolProfile.Capability.TYPE10_LAYOUT));
        assertEquals(ReplayProtocolProfile.Level.STRUCTURALLY_COMPATIBLE,
                ReplayProtocolProfile.levelOf("11.22.0_china", ReplayProtocolProfile.Capability.ENTITY_METHOD_ENVELOPE));
        assertEquals(ReplayProtocolProfile.Level.UNKNOWN,
                ReplayProtocolProfile.levelOf("11.22.0_china", ReplayProtocolProfile.Capability.SETTLEMENT_SCHEMA));
        assertEquals(ReplayProtocolProfile.Level.UNKNOWN,
                ReplayProtocolProfile.levelOf("11.22.0_china", ReplayProtocolProfile.Capability.METHOD_SEMANTICS));
        assertEquals(ReplayProtocolProfile.Level.UNKNOWN,
                ReplayProtocolProfile.levelOf("11.22.0_china", ReplayProtocolProfile.Capability.ENTITY_TYPE_ID_SEMANTIC));
    }
}
