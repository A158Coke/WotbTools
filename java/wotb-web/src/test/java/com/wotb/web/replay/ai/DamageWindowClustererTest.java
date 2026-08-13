package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 掉血窗口聚类器单测：空事件 / 单事件 / 连续聚类 / 大间隔拆分 /
 * 真实 entity 映射（accountId 为 null）/ 准备阶段过滤 / 非受击者忽略 /
 * 攻击者解析（单一攻击者≠集火、多攻击者才可集火、未解析不得集火）。
 */
class DamageWindowClustererTest {

    private static final long VICTIM = 10_001L;

    @Test
    void emptyOrInvalidInputReturnsNoWindows() {
        assertTrue(DamageWindowClusterer.receivedWindows(null, null, VICTIM).isEmpty());
        assertTrue(DamageWindowClusterer.receivedWindows(null, recon(0f), VICTIM).isEmpty());
        assertTrue(DamageWindowClusterer.receivedWindows(
                null, recon(0f, hit(5f, 2L, VICTIM, 300)), -1L).isEmpty());
    }

    @Test
    void singleEventIsOneWindow() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f, hit(35f, 2L, VICTIM, 400)), VICTIM);
        assertEquals(1, windows.size());
        final DamageWindowClusterer.DamageWindow window = windows.getFirst();
        assertEquals(5f, window.startSec());
        assertEquals(5f, window.endSec());
        assertEquals(400, window.totalDamage());
        assertEquals(1, window.hitCount());
        assertEquals(1, window.uniqueAttackerCount());
        assertFalse(window.attackersUnresolved());
    }

    @Test
    void eventsWithinGapMergeIntoOneWindow() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
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
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hit(35f, 2L, VICTIM, 400),
                                hit(80f, 2L, VICTIM, 700)), VICTIM);
        assertEquals(2, windows.size());
        assertEquals(5f, windows.get(0).startSec());
        assertEquals(50f, windows.get(1).startSec());
    }

    @Test
    void singleAttackerMultipleHitsIsNotFocusFire() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hit(35f, 2L, VICTIM, 400),
                                hit(38f, 2L, VICTIM, 700),
                                hit(41f, 2L, VICTIM, 300)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(1, windows.getFirst().uniqueAttackerCount(),
                "同一攻击者连续多炮只能算 1 个攻击者，不得作为集火证据");
        assertFalse(windows.getFirst().attackersUnresolved());
    }

    @Test
    void twoDistinctAttackersAreFocusFireCandidate() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hit(35f, 2L, VICTIM, 400),
                                hit(37f, 3L, VICTIM, 300),
                                hit(39f, 2L, VICTIM, 200)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(2, windows.getFirst().uniqueAttackerCount(),
                "两个不同攻击者（2、3）才算多车集火证据");
        assertFalse(windows.getFirst().attackersUnresolved());
    }

    @Test
    void unresolvedAttackerMarksWindowAndIsNotCounted() {
        // attackerEid=999 无映射且无直填 accountId → 攻击者无法解析，不得计数/不得断言集火
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                new DamageEvent(0, new ReplayTimestamp(35f, null), 8,
                                        DecodeConfidence.EXACT, 999, 0, null, VICTIM, 400, false)),
                        VICTIM);
        assertEquals(1, windows.size());
        assertEquals(0, windows.getFirst().uniqueAttackerCount());
        assertTrue(windows.getFirst().attackersUnresolved());
    }

    @Test
    void entityMappingResolvesNullAccountIdsFromRealDecoderShape() {
        // 模拟真实 decoder：DamageEvent 的 accountId 恒为 null，只有 eid；映射来自 ParticipantMappingEvent
        final Battle battle = new Battle();
        battle.players = List.of(
                player(1001L, 1, "Ally"), player(2001L, 2, "EnemyA"), player(2002L, 2, "EnemyB"));
        final ReplayReconstruction recon = reconWithMapping(
                30f,
                List.of(
                        new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                                DecodeConfidence.EXACT, 10, 1001L),
                        new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                                DecodeConfidence.EXACT, 20, 2001L),
                        new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                                DecodeConfidence.EXACT, 30, 2002L)),
                new DamageEvent(4, new ReplayTimestamp(35f, null), 8,
                        DecodeConfidence.EXACT, 20, 10, null, null, 400, false),
                new DamageEvent(5, new ReplayTimestamp(38f, null), 8,
                        DecodeConfidence.EXACT, 30, 10, null, null, 300, false),
                new DamageEvent(6, new ReplayTimestamp(41f, null), 8,
                        DecodeConfidence.EXACT, 20, 10, null, null, 200, false));

        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, recon, 1001L);
        assertEquals(1, windows.size(), "真实事件经 entity 映射后必须能生成窗口");
        assertEquals(2, windows.getFirst().uniqueAttackerCount(),
                "EnemyA(2001) 与 EnemyB(2002) 是两个不同攻击者");
        assertFalse(windows.getFirst().attackersUnresolved());
    }

    @Test
    void preBattleAndNonVictimEventsAreIgnored() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hit(10f, 2L, VICTIM, 500),    // 准备阶段
                                hit(40f, 2L, 9_999L, 999),    // 其他受击者
                                hit(0f, 2L, VICTIM, 0)),      // 零伤害
                        VICTIM);
        assertTrue(windows.isEmpty());
    }

    private static PlayerResult player(final long accountId, final int team, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.nickname = nickname;
        p.tankId = 4481;
        p.tankName = "Kranvagn";
        return p;
    }

    private static DamageEvent hit(final float clock, final long attacker,
                                   final long victim, final int amount) {
        return new DamageEvent(0, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, 0, 0, attacker, victim, amount, false);
    }

    private static ReplayReconstruction recon(final Float battleStart, final DamageEvent... events) {
        return new ReplayReconstruction(null, null, 600f, battleStart, List.of(),
                List.<ReplayEvent>of(events), List.of(), null, null, null);
    }

    private static ReplayReconstruction reconWithMapping(final Float battleStart,
                                                         final List<ParticipantMappingEvent> mappings,
                                                         final DamageEvent... events) {
        final List<ReplayEvent> all = new java.util.ArrayList<>(mappings);
        all.addAll(List.of(events));
        return new ReplayReconstruction(null, null, 600f, battleStart, List.of(),
                all, List.of(), null, null, null);
    }
}
