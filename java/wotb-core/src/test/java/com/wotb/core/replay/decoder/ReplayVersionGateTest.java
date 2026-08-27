package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 版本门禁（计划 §A2）：closed semantics 只对已知版本族 AFFIRMED。
 */
class ReplayVersionGateTest {

    @Test
    void allowsCurrentFamily() {
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china"));
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china_apple"));
        assertTrue(ReplayVersionGate.isCurrentFamily("11.19.0_china"));
        assertTrue(ReplayVersionGate.isCurrentFamily("11.19.0_china_apple"));
    }

    @Test
    void allowsLegacyCompatibleFamily() {
        // 仓库既有 fixtures 实测同布局（common/fixtures/replays/cw-training-15-14-example.wotbreplay）
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.18.0_china"));
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.18.0_china_apple"));
        assertFalse(ReplayVersionGate.isCurrentFamily("11.18.0_china_apple"));
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
        // 不能把 "11.19.0_china_fake_build" 之外的同前缀变体误判（仅下划线子构建）
        assertTrue(ReplayVersionGate.closedSemanticsAllowed("11.19.0_china_apple_beta"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.19.0_chin"));
        assertFalse(ReplayVersionGate.closedSemanticsAllowed("11.19.0_chinaX"));
    }
}
