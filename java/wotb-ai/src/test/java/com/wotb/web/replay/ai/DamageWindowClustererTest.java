package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 掉血窗口聚类器单测：空事件 / 单事件 / 连续聚类 / 大间隔拆分 /
 * 真实 entity 映射（accountId 为 null）/ 准备阶段过滤 / 非受击者忽略 /
 * 攻击者解析（单一攻击者≠集火、多攻击者才可集火、未解析不得集火）。
 *
 * <p>口径：窗口只消费权威 HP loss（Type-7 推导），fixture 用
 * {@code hpLoss(...)} helper 生成「prev/cur HP sample 对 + 单条 DAMAGE 通知」，
 * 使每条掉血都得到精确 attribution。</p>
 */
class DamageWindowClustererTest {

    private static final long VICTIM = 10_001L;

    @Test
    void emptyOrInvalidInputReturnsNoWindows() {
        assertTrue(DamageWindowClusterer.receivedWindows(null, null, VICTIM).isEmpty());
        assertTrue(DamageWindowClusterer.receivedWindows(null, recon(0f), VICTIM).isEmpty());
        assertTrue(DamageWindowClusterer.receivedWindows(
                null, recon(0f, hpLoss(5f, 2L, VICTIM, 300)), -1L).isEmpty());
    }

    @Test
    void singleEventIsOneWindow() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f, hpLoss(35f, 2L, VICTIM, 400)), VICTIM);
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
                                hpLoss(35f, 2L, VICTIM, 400),
                                hpLoss(38f, 2L, VICTIM, 300),
                                hpLoss(43f, 2L, VICTIM, 200)), VICTIM);
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
                                hpLoss(35f, 2L, VICTIM, 400),
                                hpLoss(80f, 2L, VICTIM, 700)), VICTIM);
        assertEquals(2, windows.size());
        assertEquals(5f, windows.get(0).startSec());
        assertEquals(50f, windows.get(1).startSec());
    }

    @Test
    void singleAttackerMultipleHitsIsNotFocusFire() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hpLoss(35f, 2L, VICTIM, 400),
                                hpLoss(38f, 2L, VICTIM, 700),
                                hpLoss(41f, 2L, VICTIM, 300)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(1, windows.getFirst().uniqueAttackerCount(),
                "同一攻击者连续多炮只能算 1 个攻击者，不得作为集火证据");
        assertFalse(windows.getFirst().attackersUnresolved());
        assertFalse(windows.getFirst().focusFireCandidate(), "单一攻击者绝不构成短时集火");
    }

    @Test
    void twoDistinctAttackersAreFocusFireCandidate() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hpLoss(35f, 2L, VICTIM, 400),
                                hpLoss(37f, 3L, VICTIM, 300),
                                hpLoss(39f, 2L, VICTIM, 200)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(2, windows.getFirst().uniqueAttackerCount(),
                "两个不同攻击者（2、3）才算多车集火证据");
        assertFalse(windows.getFirst().attackersUnresolved());
        assertTrue(windows.getFirst().focusFireCandidate(),
                "总跨度 4s ≤ 15s、攻击者 2 个且无未解析 → 可作短时集火证据");
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
        assertFalse(windows.getFirst().focusFireCandidate(), "攻击者未解析不得断言集火");
    }

    @Test
    void chainedClusteringLongSpanIsNotShortFocusFire() {
        // 相邻间隔均 ≤10s（9s），链式聚类成一个窗口，但总跨度 27s 超阈值：
        // 即使攻击者 ≥2 也不得当作短时集火。
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hpLoss(31f, 2L, VICTIM, 100),
                                hpLoss(40f, 3L, VICTIM, 100),
                                hpLoss(49f, 2L, VICTIM, 100),
                                hpLoss(58f, 3L, VICTIM, 100)), VICTIM);
        assertEquals(1, windows.size(), "9s 间隔链式聚类应合并为单一窗口");
        final DamageWindowClusterer.DamageWindow window = windows.getFirst();
        assertEquals(1f, window.startSec());
        assertEquals(28f, window.endSec());
        assertEquals(2, window.uniqueAttackerCount());
        assertFalse(window.attackersUnresolved());
        assertFalse(window.focusFireCandidate(),
                "总跨度 27s 超短窗口阈值，链式聚类不得被当成短时集火");
    }

    @Test
    void twoAttackersWithinShortSpanIsFocusFireCandidate() {
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f,
                                hpLoss(31f, 2L, VICTIM, 100),
                                hpLoss(40f, 3L, VICTIM, 100)), VICTIM);
        assertEquals(1, windows.size());
        final DamageWindowClusterer.DamageWindow window = windows.getFirst();
        assertEquals(9f, window.endSec() - window.startSec());
        assertEquals(2, window.uniqueAttackerCount());
        assertTrue(window.focusFireCandidate(),
                "总跨度 9s ≤ 15s、攻击者 2 个且无未解析 → 可作短时集火证据");
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
                                hpLoss(10f, 2L, VICTIM, 500),    // 准备阶段
                                hpLoss(40f, 2L, 9_999L, 999),    // 其他受击者
                                hpLoss(0f, 2L, VICTIM, 0)),      // 零伤害
                        VICTIM);
        assertTrue(windows.isEmpty());
    }

    @Test
    void unprovenEntryHpUsesBaseBaselineAndFailsClosedCritical() {
        // Kranvagn（4481）tankopedia base 2400、无受击前样本证明进场满血（BASE_FALLBACK）：
        // pct 按 base 输出（79%），但 criticalWindow fail closed（base 只是下界，真实 entry 可能更高）。
        final Battle battle = new Battle();
        battle.players = List.of(player(VICTIM, 1, "Victim"));
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, recon(30f,
                        hpLoss(35f, 2L, VICTIM, 1000),
                        hpLoss(40f, 2L, VICTIM, 900)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(79, Math.round(windows.getFirst().damageVsEntryMaxHpPct()));
        assertFalse(windows.getFirst().entryHpProven(), "未证明进场满血 → base baseline");
        assertFalse(windows.getFirst().criticalWindow(), "base baseline 不得判定短窗高额伤害窗口（fail closed）");
    }

    @Test
    void provenEntryHpWithEquipmentBonusUsesEntryDenominator() {
        // 进场满血被证明（OBSERVED_EXACT，含装备/物资加成 entry=2600）：
        // 同一 5s 窗口伤害 1900 → 1900/2600 = 73% < 75% → 不得标短窗高额伤害窗口
        final Battle battle = new Battle();
        final PlayerResult victim = player(VICTIM, 1, "Victim");
        victim.entryHpSource = EntryHpSource.OBSERVED_EXACT;
        victim.entryHp = 2600;
        battle.players = List.of(victim);
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, recon(30f,
                        hpLoss(35f, 2L, VICTIM, 1000),
                        hpLoss(40f, 2L, VICTIM, 900)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(73, Math.round(windows.getFirst().damageVsEntryMaxHpPct()),
                "分母必须用已证明的进场满血量（含装备/物资加成），而不是 base");
        assertTrue(windows.getFirst().entryHpProven());
        assertFalse(windows.getFirst().criticalWindow(),
                "相对进场满血量不足 75% 时不得误标短窗高额伤害窗口");
    }

    @Test
    void unprovenCurrentSampleNeverCreatesFalseCriticalWindow() {
        // 反例（用户回归）：tankopedia base=2400、真实进场满血=2600、
        // 整场观测最大 currentHp=2500（已受伤，未证明为进场满血）。
        // 直接 1900/2500=76% 会误报 critical；必须 fail closed（按 base baseline 79%，不判 critical）。
        final Battle battle = new Battle();
        final PlayerResult victim = player(VICTIM, 1, "Victim");
        victim.observedMaxHp = 2500; // 只是观测最大 current，无受击前证明 → 不得当 entry
        battle.players = List.of(victim);
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, recon(30f,
                        hpLoss(35f, 2L, VICTIM, 1000),
                        hpLoss(40f, 2L, VICTIM, 900)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(79, Math.round(windows.getFirst().damageVsEntryMaxHpPct()),
                "未证明进场满血 → 分母必须是 tankopedia base，不得用观测最大 current");
        assertFalse(windows.getFirst().criticalWindow(),
                "不得用可能低于真实进场满血的 current sample 制造 criticalWindow");
    }

    @Test
    void slowLongWindowIsNotCritical() {
        final Battle battle = new Battle();
        battle.players = List.of(player(VICTIM, 1, "Victim"));
        // 相邻间隔 ≤10s 链式聚类成单个跨度 15s 的窗口：掉血 79% 但跨度 >10s，不是「短窗大额掉血」
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, recon(30f,
                        hpLoss(35f, 2L, VICTIM, 1000),
                        hpLoss(44f, 2L, VICTIM, 500),
                        hpLoss(50f, 2L, VICTIM, 400)), VICTIM);
        assertEquals(1, windows.size());
        assertEquals(15f, windows.getFirst().endSec() - windows.getFirst().startSec());
        assertEquals(79, Math.round(windows.getFirst().damageVsEntryMaxHpPct()));
        assertFalse(windows.getFirst().criticalWindow());
    }

    @Test
    void unknownEntryMaxHpYieldsUnknownPctAndFailsClosed() {
        // battle=null → 无满血量口径 → pct 未知，不得误标短窗高额伤害窗口
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(
                        null, recon(30f, hpLoss(35f, 2L, VICTIM, 400)), VICTIM);
        assertEquals(null, windows.getFirst().damageVsEntryMaxHpPct());
        assertFalse(windows.getFirst().criticalWindow());
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

    /**
     * 一条权威掉血：prev/cur HP sample 对 + 单条 DAMAGE 通知（直填账号）。
     * 窗口 (t-0.5, t] 内只有这一条通知 → 精确 attribution。
     */
    private static DamageEvent hpLoss(final float clock, final long attacker,
                                      final long victim, final int amount) {
        return new DamageEvent(0, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, (int) attacker, (int) victim, attacker, victim, amount, false);
    }

    /**
     * 构造带 HP 链的 recon：为每条 damage 自动生成 prev/cur HP sample（victim 从 2000 逐条递减），
     * 并为每个出现的账号生成 entityId→accountId 映射与参与者（battle 为 null 时也能解析身份）。
     */
    private static ReplayReconstruction recon(final Float battleStart, final DamageEvent... events) {
        return recon(battleStart, List.of(), events);
    }

    private static ReplayReconstruction recon(final Float battleStart,
                                              final List<ParticipantMappingEvent> explicitMappings,
                                              final DamageEvent... events) {
        final List<ReplayEvent> all = new ArrayList<>();
        final List<ReplayEvent> sortedEvents = new ArrayList<>(List.of(events));
        sortedEvents.sort(Comparator.comparingDouble(e ->
                e.timestamp() == null ? 0 : e.timestamp().rawClockSec()));
        // victim 账号 → 当前 HP（从 2000 递减），生成 HP 链
        final Map<Long, Integer> curHp = new LinkedHashMap<>();
        final Map<Long, Integer> victimEid = new LinkedHashMap<>();
        for (final ReplayEvent e : sortedEvents) {
            if (!(e instanceof DamageEvent d)) {
                continue;
            }
            final Long victim = d.victimAccountId() != null && d.victimAccountId() > 0
                    ? d.victimAccountId()
                    : accountOf(d.victimEid(), explicitMappings);
            if (victim == null || victim <= 0 || d.damage() <= 0) {
                continue;
            }
            final int eid = d.victimEid() > 0 ? d.victimEid() : (int) (long) victim;
            victimEid.putIfAbsent(victim, eid);
            final float t = d.timestamp().rawClockSec();
            if (battleStart != null && t < battleStart) {
                continue; // 准备阶段：HP sample 也在战斗开始前，derive 会过滤
            }
            final int prev = curHp.getOrDefault(victim, 2000);
            all.add(new HealthChangedEvent(seq(victim, 0), new ReplayTimestamp(t - 0.5f, null), 7,
                    DecodeConfidence.EXACT, eid, prev, null, true));
            all.add(new HealthChangedEvent(seq(victim, 1), new ReplayTimestamp(t, null), 7,
                    DecodeConfidence.EXACT, eid, prev - d.damage(), null, true));
            curHp.put(victim, prev - d.damage());
        }
        // 为每个出现的账号补 mapping + 参与者（battle=null 时 identity 从 participants 解析）
        final Map<Long, Integer> allAccounts = new LinkedHashMap<>();
        for (final DamageEvent d : events) {
            if (d.victimAccountId() != null && d.victimAccountId() > 0) {
                allAccounts.put(d.victimAccountId(), (int) (long) d.victimAccountId());
            }
            if (d.attackerAccountId() != null && d.attackerAccountId() > 0) {
                allAccounts.put(d.attackerAccountId(), (int) (long) d.attackerAccountId());
            }
        }
        allAccounts.putAll(victimEid);
        final List<ParticipantMappingEvent> mappings = new ArrayList<>(explicitMappings);
        final List<BattleParticipant> participants = new ArrayList<>();
        for (final Map.Entry<Long, Integer> e : allAccounts.entrySet()) {
            final int eid = e.getValue();
            final long account = e.getKey();
            boolean known = false;
            for (final ParticipantMappingEvent m : explicitMappings) {
                if (m.entityId() == eid && m.accountId() == account) {
                    known = true;
                    break;
                }
            }
            if (!known) {
                mappings.add(new ParticipantMappingEvent(seq(account, 2), new ReplayTimestamp(1f, null), 8,
                        DecodeConfidence.EXACT, eid, account));
            }
            participants.add(new BattleParticipant(account, "P" + account, 1, 4481, "kranvagn", false));
        }
        all.addAll(mappings);
        all.addAll(List.of(events));
        return new ReplayReconstruction(null, null, 600f, battleStart,
                participants, all, List.of(), null, null, null);
    }

    /** 与 recon 相同，但保留调用方显式提供的 mapping（不自动补）。 */
    private static ReplayReconstruction reconWithMapping(final Float battleStart,
                                                         final List<ParticipantMappingEvent> mappings,
                                                         final DamageEvent... events) {
        final List<ReplayEvent> all = new ArrayList<>(mappings);
        // HP 链：victim eid=10（映射已提供），从 2000 递减
        int prev = 2000;
        final List<ReplayEvent> sortedEvents = new ArrayList<>(List.of(events));
        sortedEvents.sort(Comparator.comparingDouble(e ->
                e.timestamp() == null ? 0 : e.timestamp().rawClockSec()));
        for (final ReplayEvent e : sortedEvents) {
            if (!(e instanceof DamageEvent d)) {
                continue;
            }
            final float t = d.timestamp().rawClockSec();
            all.add(new HealthChangedEvent(900 + (int) t, new ReplayTimestamp(t - 0.5f, null), 7,
                    DecodeConfidence.EXACT, d.victimEid(), prev, null, true));
            all.add(new HealthChangedEvent(901 + (int) t, new ReplayTimestamp(t, null), 7,
                    DecodeConfidence.EXACT, d.victimEid(), prev - d.damage(), null, true));
            prev -= d.damage();
        }
        all.addAll(List.of(events));
        return new ReplayReconstruction(null, null, 600f, battleStart,
                List.of(), all, List.of(), null, null, null);
    }

    private static Long accountOf(final int entityId, final List<ParticipantMappingEvent> mappings) {
        for (final ParticipantMappingEvent m : mappings) {
            if (m.entityId() == entityId && m.accountId() > 0) {
                return m.accountId();
            }
        }
        return null;
    }

    private static int seq(final long key, final int salt) {
        return (int) ((key * 31 + salt) % 100_000) + 1;
    }
}