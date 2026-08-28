package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 版本门禁（§A2 / PR162 repair Blocker 2）：PR147 closed semantics 只对
 * {@code 11.19.0_china*} canonical 家族 AFFIRMED；11.18 仅 container/settlement + 显式
 * legacy-compat surface 兼容，不得自动获得 PR147 closed numeric meanings（method38 位图 /
 * modifier / component 命名空间 / method36 字段语义等）；unknown/future 版本 raw-preserve，
 * 不 crash、不伪造语义。
 */
class ReplayVersionGateTest {

    @Test
    void allowsCurrentNonAppleAndAppleFamily() {
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china_apple"));
    }

    @Test
    void rejectsLegacyCompatibleFamilyForClosedSemantics() {
        // 仓库既有 fixtures 结构兼容（container/settlement），但 PR147 closed decoder 不对 11.18 开放
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.18.0_china"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.18.0_china_apple"));
    }

    @Test
    void rejectsUnknownAndBlankVersions() {
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.20.0_china"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("12.0.0_eu"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("1.2.3"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed(null));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed(""));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("   "));
    }

    @Test
    void prefixMatchingIsBoundarySafe() {
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china_apple_beta"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.19.0_chin"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.19.0_chinaX"));
    }

    // ---- P0-3：method0/1/5/17/20/27/29 legacy-compatible 观测布局版本门禁 ----

    @Test
    void methodLayoutAllowedCoversCurrentAndLegacyOnly() {
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.19.0_china_apple"));
        assertTrue(ReplayVersionGate.methodLayoutAllowed("11.18.0_china_apple"));
        assertFalse(ReplayVersionGate.methodLayoutAllowed("11.20.0_china"), "future 不得自动获得 method 布局语义");
        assertFalse(ReplayVersionGate.methodLayoutAllowed("12.0.0_eu"));
        assertFalse(ReplayVersionGate.methodLayoutAllowed("11.17.0_china"));
        assertFalse(ReplayVersionGate.methodLayoutAllowed(null));
    }

    // ---- P0-2：Type4/Type5/Type33 entity-lifecycle 观测布局版本门禁 ----

    @Test
    void entityLifecycleLayoutAllowedCoversCurrentAndLegacyOnly() {
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.19.0_china_apple"));
        assertTrue(ReplayVersionGate.entityLifecycleLayoutAllowed("11.18.0_china_apple"));
        assertFalse(ReplayVersionGate.entityLifecycleLayoutAllowed("11.20.0_china"),
                "future 不得自动获得 entity-lifecycle 布局语义");
        assertFalse(ReplayVersionGate.entityLifecycleLayoutAllowed("12.0.0_eu"));
        assertFalse(ReplayVersionGate.entityLifecycleLayoutAllowed("11.17.0_china"));
        assertFalse(ReplayVersionGate.entityLifecycleLayoutAllowed(null));
        assertFalse(ReplayVersionGate.entityLifecycleLayoutAllowed(""));
    }
}
