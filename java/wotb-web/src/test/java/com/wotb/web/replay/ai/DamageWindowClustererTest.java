package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 掉血窗口聚类器单测：空事件 / 单事件 / 连续聚类 / 大间隔拆分 / 致死标记 /
 * 准备阶段过滤 / 非受击者忽略。
 */
class DamageWindowClustererTest {

    private static final long VICTIM = 10_001L;

    @Test
    void emptyOrInvalidInputReturnsNoWindows() {
        assertTrue(DamageWindowClusterer.receivedWindows(null, VICTIM).isEmpty());
        assertTrue(DamageWindowClusterer.receivedWindows(recon(0f), VICTIM).isEmpty());
        assertTrue(DamageWindowClusterer.receivedWindows(recon(0f, hit(5f, 2L, VICTIM, 300)), -1L).isEmpty());
    }

    @Test
    void singleEventIsOneWindow() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(recon(30f, hit(35f, 2L, VICTIM, 400)), VICTIM);
        assertEquals(1, windows.size());
        final DamageWindowClusterer.DamageWindow window = windows.getFirst();
        assertEquals(5f, window.startSec());
        assertEquals(5f, window.endSec());
        assertEquals(400, window.totalDamage());
        assertEquals(1, window.hitCount());
        assertFalse(window.lethal());
    }

    @Test
    void eventsWithinGapMergeIntoOneWindow() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(recon(30f,
                        hit(35f, 2L, VICTIM, 400),
                        hit(38f, 2L, VICTIM, 300),
                        hit(43f, 2L, VICTIM, 200)), VICTIM);
        assertEquals(1, windows.size());
        final DamageWindowClusterer.DamageWindow window = windows.getFirst();
        assertEquals(5f, window.startSec());
        assertEquals(13f, window.endSec());
        assertEquals(900, window.totalDamage());
        assertEquals(3, window.hitCount());
    }

    @Test
    void largeGapSplitsWindows() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(recon(30f,
                        hit(35f, 2L, VICTIM, 400),
                        hit(80f, 2L, VICTIM, 700)), VICTIM);
        assertEquals(2, windows.size());
        assertEquals(5f, windows.get(0).startSec());
        assertEquals(50f, windows.get(1).startSec());
    }

    @Test
    void lethalHitMarksTheWholeWindow() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(recon(30f,
                        hit(35f, 2L, VICTIM, 400),
                        hit(38f, 2L, VICTIM, 700, true)), VICTIM);
        assertEquals(1, windows.size());
        assertTrue(windows.getFirst().lethal());
    }

    @Test
    void preBattleAndNonVictimEventsAreIgnored() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(recon(30f,
                        hit(10f, 2L, VICTIM, 500),    // 准备阶段
                        hit(40f, 2L, 9_999L, 999),    // 其他受击者
                        hit(0f, 2L, VICTIM, 0)),      // 零伤害
                VICTIM);
        assertTrue(windows.isEmpty());
    }

    private static DamageEvent hit(final float clock, final long attacker,
                                   final long victim, final int amount) {
        return new DamageEvent(0, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, 0, 0, attacker, victim, amount, false);
    }

    private static DamageEvent hit(final float clock, final long attacker,
                                   final long victim, final int amount, final boolean lethal) {
        return new DamageEvent(0, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, 0, 0, attacker, victim, amount, lethal);
    }

    private static ReplayReconstruction recon(final Float battleStart, final DamageEvent... events) {
        return new ReplayReconstruction(null, null, 600f, battleStart, List.of(),
                List.<ReplayEvent>of(events), List.of(), null, null, null);
    }
}
