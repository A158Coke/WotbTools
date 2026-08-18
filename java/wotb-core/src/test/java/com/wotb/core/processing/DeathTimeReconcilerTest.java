package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link DeathTimeReconciler} 回归测试：
 * 死亡时刻只来自可归属到同一实体/账号的权威 HP 死亡证据（EXACT alive=false），
 * 覆盖「残血但未阵亡被 legacy damage-threshold 启发式提前判死」的 IS-4 场景。
 */
class DeathTimeReconcilerTest {

    private static final float BATTLE_START = 0f;

    private static ReplayTimestamp ts(final float rawClockSec) {
        return new ReplayTimestamp(rawClockSec, null);
    }

    private static HealthChangedEvent hp(
            final int seq, final float sec, final int eid,
            final Integer hp, final Boolean alive, final DecodeConfidence conf) {
        return new HealthChangedEvent(seq, ts(sec), 7, conf, eid, hp, null, alive);
    }

    private static HealthChangedEvent exactDeath(final int seq, final float sec, final int eid) {
        return hp(seq, sec, eid, 0, false, DecodeConfidence.EXACT);
    }

    private static ParticipantMappingEvent mapping(final int seq, final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq, ts(0f), 8, DecodeConfidence.EXACT,
                eid, accountId, "p" + accountId, 1);
    }

    private static PlayerResult player(
            final long accountId, final boolean survived, final long deathMs, final double survivalSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.survived = survived;
        p.deathTimeMillis = deathMs;
        p.survivalTimeSec = survivalSec;
        p.tankId = 6145;
        return p;
    }

    private static Battle battle(final double durationS, final PlayerResult... players) {
        final Battle b = new Battle();
        b.durationS = durationS;
        b.players = new ArrayList<>(List.of(players));
        return b;
    }

    // ---- Test A：跨实体隔离 ----

    @Test
    void unknownSentinelOnEntityADoesNotLeakDeathFromEntityB() {
        // A：非存活但只有 UNKNOWN sentinel（alive=null，0xFFFF 语义）→ 无死亡证据，保留 legacy
        // B：非存活，实体 202 同窗内 EXACT alive=false @100s → 校准为 100
        final PlayerResult a = player(1001L, false, 0L, 40.0);
        final PlayerResult b = player(2002L, false, 0L, 95.0);
        final Battle battle = battle(300.0, a, b);

        final List<ReplayEvent> events = List.of(
                mapping(1, 101, 1001L),
                mapping(2, 202, 2002L),
                // A 的 UNKNOWN sentinel：不得产出死亡证据
                hp(3, 50f, 101, null, null, DecodeConfidence.PARTIAL),
                // B 的真实死亡
                exactDeath(4, 100f, 202));

        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);

        assertEquals(40.0, PlayerResultFormat.deathSec(a), 1e-9,
                "A 的 ambiguous sentinel 不得变成死亡，也不得借用 B 的证据");
        assertEquals(100.0, PlayerResultFormat.deathSec(b), 1e-9);
    }

    @Test
    void survivorIsNeverTouchedEvenWithDeathEvidence() {
        final PlayerResult a = player(1001L, true, 0L, 300.0); // 存活
        final Battle battle = battle(300.0, a);
        final List<ReplayEvent> events = List.of(
                mapping(1, 101, 1001L),
                exactDeath(2, 50f, 101)); // 事件流有 alive=false，但结算说存活 → 不信
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);
        assertEquals(300.0, a.survivalTimeSec, 1e-9);
    }

    // ---- Test B：残血不是死亡 ----

    @Test
    void lowHpAliveEventsDoNotProduceDeathWithoutFinalEvidence() {
        final PlayerResult p = player(3117015664L, false, 0L, 96.9); // legacy 估算（IS-4 场景）
        final Battle battle = battle(218.4, p);
        final List<ReplayEvent> events = List.of(
                mapping(1, 280127282, 3117015664L),
                hp(2, 96.91f, 280127282, 102, true, DecodeConfidence.EXACT),
                hp(3, 121.23f, 280127282, 65, true, DecodeConfidence.EXACT));
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);
        assertEquals(96.9, PlayerResultFormat.deathSec(p), 1e-9,
                "残血 alive=true 事件不得推死亡时刻，无证据时保留 legacy");
    }

    // ---- Test C：unknown HP 不等于死亡 ----

    @Test
    void unknownHpSentinelIsNotDeathEvidence() {
        final PlayerResult p = player(1001L, false, 0L, 80.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = List.of(
                mapping(1, 101, 1001L),
                hp(2, 60f, 101, null, null, DecodeConfidence.PARTIAL), // 0xFFFF 语义
                hp(3, 90f, 101, null, null, DecodeConfidence.PARTIAL));
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);
        assertEquals(80.0, PlayerResultFormat.deathSec(p), 1e-9,
                "unknown HP 不得无依据变成死亡");
    }

    // ---- Test D：真实 replay fixture（IS-4 场景）----

    @Test
    void is4RealReplayFixtureDeathSecIs128_12Not96_9() {
        final PlayerResult p = player(3117015664L, false, 0L, 96.9);
        p.damageReceived = 2783;
        final Battle battle = battle(218.4, p);
        final int eid = 280127282;

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mapping(1, eid, 3117015664L));
        // 真实事件流：damage 与 HP 同刻（HP 证据权威）
        final float[][] hpTimeline = {
                {62.91f, 2376}, {66.72f, 2050}, {81.52f, 1635},
                {82.82f, 1215}, {89.32f, 846}, {92.32f, 483},
                {96.91f, 102}, {121.23f, 65}, {128.12f, 0},
        };
        int seq = 2;
        for (int i = 0; i < hpTimeline.length; i++) {
            final float sec = hpTimeline[i][0];
            final int hpVal = (int) hpTimeline[i][1];
            final boolean last = i == hpTimeline.length - 1;
            events.add(hp(seq++, sec, eid, hpVal,
                    last ? false : true, DecodeConfidence.EXACT));
        }

        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);

        // rawClockSec 为 float，128.12f → double 128.119995...；容差 0.01 即可区分 96.9
        assertEquals(128.12, PlayerResultFormat.deathSec(p), 0.01,
                "IS-4 真实死亡时刻应为 128.12s（HP=0），不是 legacy 估算的 96.9s");
        assertTrue(PlayerResultFormat.deathSec(p) > 111.0,
                "01:51（111s）时 IS-4 不得显示为阵亡");
    }

    // ---- Test E：多次死亡取最后一条（争霸/复生）----

    @Test
    void multipleDeathsUseLastExactAliveFalse() {
        final PlayerResult p = player(1001L, false, 0L, 0.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = List.of(
                mapping(1, 101, 1001L),
                exactDeath(2, 60f, 101),   // 早期死亡
                hp(3, 70f, 101, 2000, true, DecodeConfidence.EXACT), // 复生
                exactDeath(4, 120f, 101)); // 最终阵亡
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);
        assertEquals(120.0, PlayerResultFormat.deathSec(p), 1e-9,
                "死亡时刻 = 最终阵亡（最后一条 alive=false），而非早期死亡");
    }

    // ---- Test F：clamp 到战斗时长 ----

    @Test
    void evidenceLaterThanDurationIsClamped() {
        final PlayerResult p = player(1001L, false, 0L, 0.0);
        final Battle battle = battle(218.4, p);
        final List<ReplayEvent> events = List.of(
                mapping(1, 101, 1001L),
                exactDeath(2, 250f, 101));
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);
        assertEquals(218.4, PlayerResultFormat.deathSec(p), 1e-9);
    }

    // ---- Test G：游戏权威死亡时刻优先，不被校准覆盖 ----

    @Test
    void settlementDeathTimeMillisTakesPriority() {
        final PlayerResult p = player(1001L, false, 111_000L, 111.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = List.of(
                mapping(1, 101, 1001L),
                exactDeath(2, 128.12f, 101));
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START);
        assertEquals(111.0, PlayerResultFormat.deathSec(p), 1e-9,
                "结算 deathTimeMillis>0 是权威，事件流证据不得覆盖");
    }

    // ---- 空输入幂等 ----

    @Test
    void nullOrEmptyInputsAreNoOps() {
        final PlayerResult p = player(1001L, false, 0L, 40.0);
        final Battle battle = battle(300.0, p);
        DeathTimeReconciler.reconcile(null, List.of(), BATTLE_START);
        DeathTimeReconciler.reconcile(battle, null, BATTLE_START);
        DeathTimeReconciler.reconcile(battle, List.of(), BATTLE_START);
        assertEquals(40.0, p.survivalTimeSec, 1e-9);
    }

    @Test
    void noMappingMeansNoChange() {
        final PlayerResult p = player(1001L, false, 0L, 40.0);
        final Battle battle = battle(300.0, p);
        // 有 alive=false 事件但无 entity→account 映射
        DeathTimeReconciler.reconcile(battle, List.of(exactDeath(1, 50f, 999)), BATTLE_START);
        assertEquals(40.0, p.survivalTimeSec, 1e-9);
    }
}
