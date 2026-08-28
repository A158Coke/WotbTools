package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Capability-based version gate (PR162 architecture): structural layouts are forward-compatible
 * (shape-validated), closed numeric semantics stay strictly evidence-gated.
 *
 * <p>This is <b>not</b> an allowlist — a future version such as {@code 11.22.0_china} keeps decoding
 * framing/header/Type10 layout/EntityProperty envelope/entity-lifecycle/method envelopes, while the
 * version-scoped closed semantics it does not verify degrade to {@code RAW/UNKNOWN}. Only the verified
 * {@code 11.19.0_china*} family inherits PR147 closed numeric meanings; 11.18 is structural + settlement
 * compatible without PR147 closed decoders.</p>
 */
class ReplayVersionGateTest {

    @Test
    void closedSemanticsOnlyForCurrentFamily() {
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china_apple"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.18.0_china"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.20.0_china"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.22.0_china"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("12.0.0_eu"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("1.2.3"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed(null));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed(""));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("   "));
    }

    @Test
    void methodSemanticsOnlyForCurrentFamily() {
        assertTrue(ReplayVersionGate.methodSemanticsAllowed("11.19.0_china"));
        assertFalse(ReplayVersionGate.methodSemanticsAllowed("11.18.0_china"));
        assertFalse(ReplayVersionGate.methodSemanticsAllowed("11.20.0_china"));
        assertFalse(ReplayVersionGate.methodSemanticsAllowed("11.22.0_china"));
        assertFalse(ReplayVersionGate.methodSemanticsAllowed(null));
    }

    @Test
    void prefixMatchingIsBoundarySafe() {
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china_apple_beta"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.19.0_chin"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.19.0_chinaX"));
    }

    // ---- Layer B structural layouts: forward-compatible (shape-validated), not version-blocked ----

    @Test
    void type10LayoutIsForwardCompatible() {
        assertTrue(ReplayVersionGate.type10LayoutAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.type10LayoutAllowed("11.18.0_china_apple"));
        assertTrue(ReplayVersionGate.type10LayoutAllowed("11.20.0_china"), "Type10 49B 结构应前向兼容");
        assertTrue(ReplayVersionGate.type10LayoutAllowed("11.22.0_china"), "future 不得因版本号拒绝稳定布局");
        assertTrue(ReplayVersionGate.type10LayoutAllowed("12.0.0_eu"));
    }

    @Test
    void entityPropertyEnvelopeIsForwardCompatible() {
        assertTrue(ReplayVersionGate.basicVehiclePropertiesAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.basicVehiclePropertiesAllowed("11.18.0_china_apple"));
        assertTrue(ReplayVersionGate.basicVehiclePropertiesAllowed("11.22.0_china"), "EntityProperty envelope 前向兼容");
    }

    @Test
    void positiveHpValueIsForwardCompatible() {
        assertTrue(ReplayVersionGate.positiveHpValueAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.positiveHpValueAllowed("11.18.0_china_apple"));
        assertTrue(ReplayVersionGate.positiveHpValueAllowed("11.22.0_china"), "普通正 HP 结构值可前向解析");
    }

    @Test
    void methodLayoutAllowedIsForwardCompatible() {
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.19.0_china_apple"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.18.0_china_apple"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.20.0_china"), "method 结构 envelope 前向兼容");
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.22.0_china"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed("12.0.0_eu"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed(null));
    }

    @Test
    void entityLifecycleLayoutAllowedIsForwardCompatible() {
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.19.0_china_apple"));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.18.0_china_apple"));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.20.0_china"), "entity-lifecycle 结构前向兼容");
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.22.0_china"));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("1.2.3"), "未知版本结构能力仅 SHAPE 门禁，不因版本号直接 UNKNOWN");
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed(null));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed(""));
    }

    @Test
    void verifiedFffeTerminalOnlyForCurrentFamily() {
        assertTrue(ReplayVersionGate.verifiedFffeTerminalAllowed("11.19.0_china"));
        assertFalse(ReplayVersionGate.verifiedFffeTerminalAllowed("11.18.0_china"));
        assertFalse(ReplayVersionGate.verifiedFffeTerminalAllowed("11.22.0_china"));
    }
}
