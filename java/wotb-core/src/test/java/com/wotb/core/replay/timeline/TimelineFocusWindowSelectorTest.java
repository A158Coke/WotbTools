package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * TimelineFocusWindowSelector（docs/architecture/battle-timeline.md §4/§5/§13-B/C/D）：
 * 连续减员窗口必须成为 Top Focus Window；正常交火/点数 swing 也能选出有意义窗口；
 * 稀疏证据不编造；不重复 delta、不 future leak。
 */
class TimelineFocusWindowSelectorTest {

    private static final int FRIENDLY_START = 1001;
    private static final int ENEMY_START = 2001;

    private static final float START_RAW = 100f;

    private static ReplayTimestamp ts(final double battleSec) {
        return new ReplayTimestamp((float) (START_RAW + battleSec), null);
    }

    private static int seq = 0;

    private static PlayerResult player(final long accountId, final int team, final String tankName) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = 4481;
        p.tankName = tankName;
        p.nickname = "p" + accountId;
        p.survived = true;
        return p;
    }

    private static Battle battle(final double durationSec) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            players.add(player(FRIENDLY_START + i, 1, "FV215b " + i));
            players.add(player(ENEMY_START + i, 2, "E 75 " + i));
        }
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 2;
        b.durationS = durationSec;
        b.players = players;
        return b;
    }

    private static ParticipantMappingEvent mapping(final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq++, ts(0), 8, DecodeConfidence.EXACT, eid, accountId);
    }

    private static PositionChangedEvent position(final int eid, final double battleSec, final float x, final float z) {
        return new PositionChangedEvent(seq++, ts(battleSec), 10, DecodeConfidence.EXACT,
                eid, 0, 0, x, 0f, z, 0f, 0f, 0f, 0f, 0f, 0f, 0);
    }

    private static HealthChangedEvent health(final int eid, final double battleSec,
                                             final Integer currentHp, final Boolean alive) {
        return new HealthChangedEvent(seq++, ts(battleSec), 7, DecodeConfidence.EXACT,
                eid, currentHp, null, alive);
    }

    private static DamageEvent damage(final int attackerEid, final int victimEid,
                                      final double battleSec, final int amount) {
        return new DamageEvent(seq++, ts(battleSec), 8, DecodeConfidence.EXACT,
                attackerEid, victimEid, null, null, amount, false);
    }

    private static SupremacyPointsChangedEvent points(final double battleSec, final int team, final int pts) {
        return new SupremacyPointsChangedEvent(seq++, ts(battleSec), 8, DecodeConfidence.EXACT, team, pts);
    }

    private static ReplayReconstruction recon(final double durationSec, final List<ReplayEvent> events) {
        return TimelineTestFixtures.recon(durationSec, events);
    }

    /** 14 车（7v7）开局：mapping + created + position + 满血。 */
    private static List<ReplayEvent> opening() {
        seq = 0;
        final List<ReplayEvent> out = new ArrayList<>();
        for (int i = 1; i <= 14; i++) {
            final int eid = i;
            final long account = eid <= 7 ? FRIENDLY_START + eid - 1 : ENEMY_START + eid - 8;
            out.add(mapping(eid, account));
            out.add(new com.wotb.core.replay.event.EntityCreatedEvent(seq++, ts(0), 0,
                    DecodeConfidence.EXACT, eid, new byte[0]));
            final float x = eid <= 7 ? eid * 10f : -eid * 10f;
            out.add(position(eid, 0, x, x));
            out.add(health(eid, 0, 2000, true));
        }
        return out;
    }

    /** 本测试：1分52秒–2分12秒 连续减员（本方 3 死 / 对方 1 死）必须成为 Top Focus Window。 */
    @Test
    void collapseWindowBecomesTopFocusWindowWithExactDeathCounts() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        // 首次接敌 50s
        events.add(damage(1, 8, 50, 400));
        events.add(health(8, 50, 1600, true));
        // 连续减员窗口：本方 112/121/132，对方 128
        events.add(health(1, 112, 0, false));
        events.add(health(2, 121, 0, false));
        events.add(health(8, 128, 0, false));
        events.add(health(3, 132, 0, false));
        // 独立残局阵亡 170s（与主窗口间隔 > 30s，不得合并）
        events.add(health(4, 170, 0, false));
        events.add(health(9, 175, 0, false));
        final BattleTimeline timeline = buildTimeline(180.0, events);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        assertFalse(windows.isEmpty(), "必须选出 focus window");
        final TimelineFocusWindowSelector.FocusWindow top = windows.getFirst();
        assertEquals(3, top.friendlyDeaths(), "本方连续 3 死");
        assertEquals(1, top.enemyDeaths(), "对方同期 1 死");
        assertTrue(top.startSec() <= 112.0, "窗口起点 ≤ 1分52秒, 实际 " + top.startSec());
        assertTrue(top.endSec() >= 132.0, "窗口终点 ≥ 2分12秒, 实际 " + top.endSec());
        // BEFORE / AFTER 存活数正确（无 future leak）
        assertEquals(7, top.before().friendlyAlive(), "窗口前本方存活 7");
        assertEquals(7, top.before().enemyAlive(), "窗口前对方存活 7");
        assertEquals(4, top.after().friendlyAlive(), "窗口后本方存活 4");
        assertEquals(6, top.after().enemyAlive(), "窗口后对方存活 6");
        // 独立残局窗口仍在输出中（信息密度同样高），但不与主窗口合并
        assertTrue(windows.stream().anyMatch(w -> w.friendlyDeaths() == 1 && w.enemyDeaths() == 1),
                "残局阵亡窗口应独立输出");
        assertTrue(windows.size() <= TimelineFocusWindowSelector.MAX_WINDOWS);
        // 不 future leak：core window 无 padding，所有事件时间都在 [112,132] 核心区间内
        for (final BattleDelta d : top.events()) {
            assertTrue(d.timeSec() <= 132.0 + 1e-6,
                    "主窗口不得包含核心区间外事件: " + d.timeSec());
            assertTrue(d.timeSec() >= 112.0 - 1e-6,
                    "主窗口不得包含核心区间前事件: " + d.timeSec());
        }
    }

    /** 正常交火 + 点数 swing（无阵亡）：仍能选出有意义的窗口（selector 不只找死亡）。 */
    @Test
    void normalBattleWithPointsAndHpSwingStillFindsMeaningfulWindow() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        events.add(damage(1, 8, 40, 400));
        events.add(health(8, 41, 1600, true));
        events.add(points(55, 1, 60));
        events.add(points(56, 2, 40));
        events.add(points(60, 1, 90));
        events.add(points(61, 2, 60));
        events.add(health(1, 70, 1200, true));
        events.add(health(2, 72, 900, true));
        events.add(damage(8, 1, 73, 350));
        events.add(damage(2, 9, 74, 300));
        final BattleTimeline timeline = buildTimeline(120.0, events);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        assertFalse(windows.isEmpty(), "无阵亡时也必须选出有意义窗口");
        final TimelineFocusWindowSelector.FocusWindow w = windows.getFirst();
        assertEquals(0, w.friendlyDeaths());
        assertEquals(0, w.enemyDeaths());
        assertTrue(w.hpSwingObserved() || w.pointsChanged() || w.engagementObserved(),
                "窗口必须携带 HP swing / 点数变化 / 交火活动之一: " + w.reasons());
        assertTrue(w.hpSwing() > 0, "HP swing 必须被捕获");
        assertTrue(w.pointsChanged(), "点数变化必须被捕获");
    }

    /** 稀疏证据：几乎无信号时 selector 不编造窗口。 */
    @Test
    void sparseEvidenceProducesNoFabricatedWindow() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        // 只有一次小型交火（无阵亡 / 无大 HP swing / 无点数）
        events.add(damage(1, 8, 60, 120));
        final BattleTimeline timeline = buildTimeline(120.0, events);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        // 允许空输出：证据不足时不编造
        if (windows.isEmpty()) {
            return;
        }
        final TimelineFocusWindowSelector.FocusWindow w = windows.getFirst();
        assertTrue(w.friendlyDeaths() == 0 && w.enemyDeaths() == 0,
                "稀疏证据不得编造阵亡");
        assertTrue(w.events().stream().noneMatch(d -> d.kind() == DeltaKind.DESTROYED),
                "稀疏证据不得包含阵亡事件");
        assertTrue(w.reasons().stream().noneMatch(r -> r.contains("掩体") || r.contains("视野")),
                "selector 不得输出战术归因");
    }

    /** 确定性：同一 timeline 两次选择结果一致。 */
    @Test
    void deterministicAcrossRuns() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        events.add(damage(1, 8, 50, 400));
        events.add(health(1, 112, 0, false));
        events.add(health(2, 121, 0, false));
        events.add(health(8, 128, 0, false));
        events.add(health(3, 132, 0, false));
        final BattleTimeline timeline = buildTimeline(180.0, events);
        final List<TimelineFocusWindowSelector.FocusWindow> a =
                TimelineFocusWindowSelector.select(timeline);
        final List<TimelineFocusWindowSelector.FocusWindow> b =
                TimelineFocusWindowSelector.select(timeline);
        assertEquals(a.size(), b.size());
        for (int i = 0; i < a.size(); i++) {
            assertEquals(a.get(i).startSec(), b.get(i).startSec(), 1e-9);
            assertEquals(a.get(i).endSec(), b.get(i).endSec(), 1e-9);
            assertEquals(a.get(i).friendlyDeaths(), b.get(i).friendlyDeaths());
            assertEquals(a.get(i).enemyDeaths(), b.get(i).enemyDeaths());
            assertEquals(a.get(i).events().size(), b.get(i).events().size());
        }
    }

    /** 不重复 delta：同一 delta 不得出现在两个不同窗口中（窗口互不重叠）。 */
    @Test
    void selectedWindowsDoNotShareDeltas() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        events.add(damage(1, 8, 50, 400));
        events.add(health(1, 112, 0, false));
        events.add(health(2, 121, 0, false));
        events.add(health(8, 128, 0, false));
        events.add(health(3, 132, 0, false));
        events.add(health(4, 170, 0, false));
        final BattleTimeline timeline = buildTimeline(180.0, events);
        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        if (windows.size() < 2) {
            return;
        }
        for (int i = 0; i < windows.size(); i++) {
            for (int j = i + 1; j < windows.size(); j++) {
                final TimelineFocusWindowSelector.FocusWindow a = windows.get(i);
                final TimelineFocusWindowSelector.FocusWindow b = windows.get(j);
                assertTrue(a.endSec() < b.startSec() || b.endSec() < a.startSec(),
                        "窗口不得重叠: " + a.startSec() + "-" + a.endSec()
                                + " vs " + b.startSec() + "-" + b.endSec());
            }
        }
    }

    /** PR #103 B2：bounded window 不得吞掉核心 3:1 collapse —— 136s 对方阵亡不得污染 [112,132] 的 3:1。 */
    @Test
    void boundedWindowKeepsCoreCollapseIntact() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        events.add(damage(1, 8, 50, 400));
        // 完整序列：112F / 121F / 128E / 132F / 136E（136 与 132 仅隔 4s）
        events.add(health(1, 112, 0, false));
        events.add(health(2, 121, 0, false));
        events.add(health(8, 128, 0, false));
        events.add(health(3, 132, 0, false));
        events.add(health(9, 136, 0, false));
        final BattleTimeline timeline = buildTimeline(180.0, events);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        assertFalse(windows.isEmpty(), "必须选出 focus window");
        final TimelineFocusWindowSelector.FocusWindow top = windows.getFirst();
        assertEquals(3, top.friendlyDeaths(), "Top collapse core 必须是本方 3 死");
        assertEquals(1, top.enemyDeaths(), "Top collapse core 必须是对方 1 死（136s 不得并入）");
        assertTrue(Math.abs(top.startSec() - 112.0) < 1.0, "core 起点 ≈112s, 实际 " + top.startSec());
        assertTrue(Math.abs(top.endSec() - 132.0) < 1.0, "core 终点 ≈132s, 实际 " + top.endSec());
        assertEquals(7, top.before().friendlyAlive(), "BEFORE 本方 7");
        assertEquals(7, top.before().enemyAlive(), "BEFORE 对方 7");
        assertEquals(4, top.after().friendlyAlive(), "AFTER 本方 4");
        assertEquals(6, top.after().enemyAlive(), "AFTER 对方 6");
        // 136s 对方阵亡不得把任何窗口的 3:1 core 改成 3:2
        assertTrue(windows.stream().noneMatch(w -> w.friendlyDeaths() == 3 && w.enemyDeaths() == 2),
                "任何窗口都不得把 3:1 core 污染成 3:2: " + windows);
    }

    /** PR #103 B2：明显单边 swing 不得被 balanced massacre 靠总死亡数压掉（交换不对称优先）。 */
    @Test
    void oneSidedSwingOutranksBalancedMassacre() {
        final List<ReplayEvent> events = new ArrayList<>(opening());
        // 单边 collapse：本方 60/65/70 连续 3 死，对方 0 死（swing=3, total=3）
        events.add(damage(1, 8, 60, 400));
        events.add(health(8, 60, 1600, true)); // 掉血 400@60 → ENGAGEMENT_ACTIVITY 对齐 collapse core（权威 HP loss）
        events.add(health(1, 60, 0, false));
        events.add(health(2, 65, 0, false));
        events.add(health(3, 70, 0, false));
        // balanced massacre：148E/150F/152E/155F/158E/160F（swing=0, total=6）
        events.add(health(8, 148, 0, false));
        events.add(health(4, 150, 0, false));
        events.add(health(9, 152, 0, false));
        events.add(health(5, 155, 0, false));
        events.add(health(10, 158, 0, false));
        events.add(health(6, 160, 0, false));
        final BattleTimeline timeline = buildTimeline(220.0, events);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        assertFalse(windows.isEmpty(), "必须选出 focus window");
        // 按公开字段复算 selector 信息分（swing*800 + total*200 + 支撑信号），验证排序：
        // 明显单边 swing（3:0）必须排在 balanced massacre（3:3，总死亡更多）之前
        final TimelineFocusWindowSelector.FocusWindow best = windows.stream()
                .max(java.util.Comparator.comparingDouble(TimelineFocusWindowSelectorTest::scoreOf))
                .orElseThrow();
        assertEquals(3, best.friendlyDeaths(), "最高分窗口必须是单边 collapse");
        assertEquals(0, best.enemyDeaths(), "最高分窗口必须是单边 collapse（对方 0 死）");
        assertTrue(Math.abs(best.startSec() - 60.0) < 1.0, "collapse core 起点 ≈60s");
        final TimelineFocusWindowSelector.FocusWindow balancedBest = windows.stream()
                .filter(w -> w.startSec() >= 140)
                .max(java.util.Comparator.comparingDouble(TimelineFocusWindowSelectorTest::scoreOf))
                .orElse(null);
        assertNotNull(balancedBest, "balanced 区域应产出候选");
        assertTrue(balancedBest.friendlyDeaths() >= 2 && balancedBest.enemyDeaths() >= 2,
                "balanced 候选应有双向死亡: " + balancedBest);
        assertTrue(scoreOf(best) > scoreOf(balancedBest),
                "单边 collapse 分数必须高于 balanced massacre（即使后者总死亡更多）: "
                        + scoreOf(best) + " vs " + scoreOf(balancedBest));
    }

    /** 复算 selector 信息分（与 TimelineFocusWindowSelector.score 同公式，仅测试排序语义）。 */
    private static double scoreOf(final TimelineFocusWindowSelector.FocusWindow w) {
        final int total = w.friendlyDeaths() + w.enemyDeaths();
        final int swing = Math.abs(w.friendlyDeaths() - w.enemyDeaths());
        double s = swing * 800.0 + total * 200.0;
        s += Math.min(w.hpSwing() / 50.0, 500.0);
        s += Math.min(w.engagementDamage() / 200.0, 300.0);
        s += w.pointsChanged() ? 60.0 : 0.0;
        s += w.firstContact() ? 40.0 : 0.0;
        return s;
    }

    private static BattleTimeline buildTimeline(final double durationSec, final List<ReplayEvent> events) {
        final ReplayReconstruction recon = recon(durationSec, events);
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle(durationSec), recon, TimelinePerspective.team(1));
        assertNotNull(result.timeline(), "timeline 必须可构建: " + result.validation().errors());
        assertTrue(result.usable(), "timeline 必须 valid: " + result.validation().errors());
        return result.timeline();
    }
}
