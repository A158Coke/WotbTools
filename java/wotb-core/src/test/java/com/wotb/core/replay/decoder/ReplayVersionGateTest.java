package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 版本门禁（§A2 / PR162 repair Blocker 2）：PR147 closed semantics 只对
 * {@code 11.19.0_china*} canonical 家族 AFFIRMED；11.18 仅 container/settlement 兼容，
 * 不得自动获得 PR147 closed numeric meanings（method38 位图 / modifier / component 命名空间 /
 * method36 字段语义等）；unknown/future 版本 raw-preserve，不 crash、不伪造语义。
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
}
