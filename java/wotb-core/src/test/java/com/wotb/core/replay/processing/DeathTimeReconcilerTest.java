package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link DeathTimeReconciler} 回归测试。
 *
 * <p>身份解析只复用 {@link TeamEntityMapper} 的权威 {@link TeamEntityMapping}
 * （冲突/低置信实体证据被拒绝，nickname fallback 复用），死亡时刻 authority 链：
 * EXACT alive=false（HP=0）&gt; 结算 deathTimeMillis（SETTLEMENT_SECOND，由 field24 lifeTime 派生）&gt; UNKNOWN=0；
 * legacy 启发式不再兜底。</p>
 */
class DeathTimeReconcilerTest {

    private static final float BATTLE_START = 0f;

    // ---- fixtures ----

    private static ReplayTimestamp ts(final float rawClockSec) {
        return new ReplayTimestamp(rawClockSec, null);
    }

    private static HealthChangedEvent hp(
            final int seq, final float sec, final int eid,
            final Integer hp, final Boolean alive, final DecodeConfidence conf) {
        return new HealthChangedEvent(seq, ts(sec), 7, conf, eid, hp, null, alive);
    }

    private static HealthChangedEvent exactAlive(final int seq, final float sec, final int eid, final int hp) {
        return hp(seq, sec, eid, hp, true, DecodeConfidence.EXACT);
    }

    private static HealthChangedEvent exactDeath(final int seq, final float sec, final int eid) {
        return hp(seq, sec, eid, 0, false, DecodeConfidence.EXACT);
    }

    private static ParticipantMappingEvent mappingEvent(final int seq, final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq, ts(0f), 8, DecodeConfidence.EXACT, eid, accountId);
    }

    private static ParticipantMappingEvent mappingEvent(
            final int seq, final int eid, final long accountId, final DecodeConfidence confidence) {
        return new ParticipantMappingEvent(seq, ts(0f), 8, confidence, eid, accountId);
    }

    private static ParticipantMappingEvent mappingEventByNickname(
            final int seq, final int eid, final String nickname, final int team) {
        return new ParticipantMappingEvent(
                seq, ts(0f), 8, DecodeConfidence.EXACT, eid, 0L, nickname, team);
    }

    private static PlayerResult player(
            final long accountId, final String nickname, final int team,
            final boolean survived, final long deathMs, final double survivalSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.nickname = nickname;
        p.team = team;
        p.survived = survived;
        p.deathTimeMillis = deathMs;
        p.survivalTimeSec = survivalSec;
        p.tankId = 6145;
        return p;
    }

    private static PlayerResult deadPlayer(final long accountId, final String nickname, final int team,
                                           final double legacySurvivalSec) {
        return player(accountId, nickname, team, false, 0L, legacySurvivalSec);
    }

    private static Battle battle(final double durationS, final PlayerResult... players) {
        final Battle b = new Battle();
        b.durationS = durationS;
        b.players = new ArrayList<>(List.of(players));
        return b;
    }

    private static ReplayReconstruction reconstruction(
            final List<BattleParticipant> participants,
            final List<? extends ReplayEvent> events) {
        return new ReplayReconstruction(
                null, null, 60f, null, participants, List.copyOf(events),
                List.of(), null, null, null);
    }

    private static TeamEntityMapping resolveMapping(
            final Battle battle, final List<? extends ReplayEvent> events) {
        return TeamEntityMapper.resolve(battle, reconstruction(List.of(), events));
    }

    /** 直接构造空映射（如无任何实体解析成功时的降级）。 */
    private static TeamEntityMapping emptyMapping() {
        return new TeamEntityMapping(Map.of(), Map.of(), 0, List.of());
    }

    private static void reconcile(final Battle battle, final List<ReplayEvent> events,
                                  final TeamEntityMapping mapping) {
        DeathTimeReconciler.reconcile(battle, events, BATTLE_START, mapping);
    }

    // ================= Blocker 1：身份复用权威 TeamEntityMapping =================

    /** Test 1：conflicting entity reuse —— 同一 entity 归属多个账号 → 整体排除，绝不 last-write-wins。 */
    @Test
    void conflictingEntityReuseIsNotCalibrated() {
        final PlayerResult a = deadPlayer(1001L, "A", 1, 40.0);
        final PlayerResult b = deadPlayer(2002L, "B", 2, 50.0);
        final Battle battle = battle(300.0, a, b);

        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 10, 1001L),
                mappingEvent(2, 10, 2002L), // 冲突：同一 entity 10 归属两个账号
                exactDeath(3, 100f, 10));

        final TeamEntityMapping mapping = resolveMapping(battle, events);
        assertNull(mapping.identity(10), "冲突实体必须被整体排除");
        assertEquals(1, mapping.ambiguousEntityCount());

        reconcile(battle, events, mapping);

        assertEquals(40.0, a.survivalTimeSec, 1e-9,
                "冲突实体的死亡证据不得校准 A");
        assertEquals(50.0, b.survivalTimeSec, 1e-9,
                "冲突实体的死亡证据不得校准 B（绝不能 last-write-wins 判 B 死亡）");
    }

    /** Test 2：低可信 mapping（PARTIAL/UNKNOWN）→ identity 不可用 → 证据被拒绝。 */
    @Test
    void lowConfidenceMappingIsNotUsed() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 40.0);
        final Battle battle = battle(300.0, p);

        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 10, 1001L, DecodeConfidence.PARTIAL),
                exactDeath(2, 100f, 10));

        final TeamEntityMapping mapping = resolveMapping(battle, events);
        assertNull(mapping.identity(10), "PARTIAL 映射不可用");

        reconcile(battle, events, mapping);

        assertEquals(40.0, p.survivalTimeSec, 1e-9,
                "低可信映射不得产出死亡时刻");
    }

    /** Test 3：nickname fallback —— accountId=0 + 唯一昵称 → 权威 PlayerResult，直接复用。 */
    @Test
    void nicknameFallbackMappingIsReused() {
        final PlayerResult p = deadPlayer(100L, "Ally", 1, 20.0);
        final Battle battle = battle(300.0, p);
        final BattleParticipant participant =
                new BattleParticipant(0L, "Ally", 1, 7, "tank", false);

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEventByNickname(1, 10, "Ally", 1));
        events.add(exactDeath(2, 100f, 10));

        final TeamEntityMapping mapping =
                TeamEntityMapper.resolve(battle, reconstruction(List.of(participant), events));
        assertEquals(100L, mapping.identity(10).accountId(),
                "canonical mapper 应通过唯一昵称解析到权威账号");

        reconcile(battle, events, mapping);

        assertEquals(100.0, p.survivalTimeSec, 1e-9,
                "死亡校准应复用 canonical nickname fallback 的解析结果，而不是因原始 accountId=0 跳过");
    }

    // ================= Blocker 2：EXACT alive=true 否决更早的 legacy death =================

    /** 无最终 EXACT alive=false 证据 → UNKNOWN=0（legacy 不再兜底）。 */
    @Test
    void noFinalDeathEvidenceIsUnknown() {
        final PlayerResult p = deadPlayer(3117015664L, "Fe1ix_k2x", 1, 0.0);
        final Battle battle = battle(218.4, p);
        final int eid = 280127282;

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, eid, 3117015664L));
        events.add(exactAlive(2, 96.91f, eid, 102));
        events.add(exactAlive(3, 121.23f, eid, 65));
        // 无 EXACT alive=false —— 真实死亡时刻未知

        reconcile(battle, events, resolveMapping(battle, events));

        assertEquals(0.0, p.survivalTimeSec, 1e-9,
                "无最终 EXACT 死亡证据 → UNKNOWN=0（legacy 启发式不再兜底）");
        assertEquals(DeathTimeSource.UNKNOWN, p.deathTimeSource);
        assertEquals(0.0, PlayerResultFormat.deathSec(p), 1e-9);
        assertTrue(PlayerResultFormat.deathSec(p) <= 0,
                "不得伪造死亡时刻（121.23 alive 不是死亡）");
    }

    /** 仅有 alive 证据 → 无死亡 authority → UNKNOWN=0（legacy 不参与）。 */
    @Test
    void aliveOnlyEvidenceIsUnknown() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0);
        final Battle battle = battle(300.0, p);

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, 10, 1001L));
        events.add(exactAlive(2, 50f, 10, 2000));

        reconcile(battle, events, resolveMapping(battle, events));

        assertEquals(0.0, p.survivalTimeSec, 1e-9,
                "仅有 alive 证据不是死亡 → UNKNOWN=0（legacy 启发式不参与）");
        assertEquals(DeathTimeSource.UNKNOWN, p.deathTimeSource);
    }

    // ================= 最后权威 lifecycle state：旧 death 不能压过更晚的 alive =================

    /** Test A：死亡 → 复生（60s dead EXACT → 70s alive EXACT），最终死亡证据缺失 → UNKNOWN，绝不能 60。 */
    @Test
    void earlyDeathRefutedByLaterAliveIsUnknown() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0); // legacy 无估算
        final Battle battle = battle(300.0, p);

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, 10, 1001L));
        events.add(exactDeath(2, 60f, 10));     // 早期死亡
        events.add(exactAlive(3, 70f, 10, 2000)); // 复生，之后无新的 alive=false

        reconcile(battle, events, resolveMapping(battle, events));

        assertEquals(0.0, PlayerResultFormat.deathSec(p), 1e-9,
                "60s 的旧死亡已被 70s 复生否决，不得作为最终 deathSec");
    }

    /** Test C：同 timestamp，alive event sequence 更晚 → 最终权威状态 alive，60s dead 不得成为最终死亡证据。 */
    @Test
    void sameTimestampAliveLaterWins() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0);
        final Battle battle = battle(300.0, p);

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, 10, 1001L));
        events.add(hp(100, 60f, 10, 0, false, DecodeConfidence.EXACT));    // seq100 dead
        events.add(hp(101, 60f, 10, 2000, true, DecodeConfidence.EXACT)); // seq101 alive（更晚）

        reconcile(battle, events, resolveMapping(battle, events));

        assertEquals(0.0, PlayerResultFormat.deathSec(p), 1e-9,
                "同秒 sequence 更晚的 alive 是最后权威状态，60s dead 不得成为最终死亡证据");
    }

    /** Test D：同 timestamp，dead event sequence 更晚 → 最终权威状态 dead → deathSec=60。 */
    @Test
    void sameTimestampDeadLaterWins() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0);
        final Battle battle = battle(300.0, p);

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, 10, 1001L));
        events.add(hp(100, 60f, 10, 2000, true, DecodeConfidence.EXACT)); // seq100 alive
        events.add(hp(101, 60f, 10, 0, false, DecodeConfidence.EXACT));   // seq101 dead（更晚）

        reconcile(battle, events, resolveMapping(battle, events));

        assertEquals(60.0, PlayerResultFormat.deathSec(p), 1e-9,
                "同秒 sequence 更晚的 dead 是最后权威状态 → 最终死亡时刻 60s");
    }

    // ================= 真实 IS-4 regression（必须持续通过） =================

    @Test
    void is4RealReplayFixtureDeathSecIs128_12Not96_9() {
        final PlayerResult p = deadPlayer(3117015664L, "Fe1ix_k2x", 1, 0.0);
        p.damageReceived = 2783;
        final Battle battle = battle(218.4, p);
        final int eid = 280127282;

        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, eid, 3117015664L));
        // 真实事件流：96.91/121.23 alive=true，128.12 HP=0 alive=false（EXACT）
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

        reconcile(battle, events, resolveMapping(battle, events));

        // rawClockSec 为 float，128.12f → double 128.119995...；容差 0.01 即可区分 96.9
        assertEquals(128.12, PlayerResultFormat.deathSec(p), 0.01,
                "IS-4 真实死亡时刻应为 128.12s（HP=0），不是 legacy 估算的 96.9s");
        assertEquals(DeathTimeSource.LIVE_EXACT, p.deathTimeSource);
        assertTrue(PlayerResultFormat.deathSec(p) > 111.0,
                "01:51（111s）时 IS-4 不得显示为阵亡");
    }

    // ================= 既有语义回归（跨实体 / sentinel / 多次死亡 / clamp / 权威优先） =================

    @Test
    void unknownSentinelOnEntityADoesNotLeakDeathFromEntityB() {
        final PlayerResult a = deadPlayer(1001L, "A", 1, 0.0);
        final PlayerResult b = deadPlayer(2002L, "B", 2, 95.0);
        final Battle battle = battle(300.0, a, b);

        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 101, 1001L),
                mappingEvent(2, 202, 2002L),
                hp(3, 50f, 101, null, null, DecodeConfidence.PARTIAL), // A 的 UNKNOWN sentinel
                exactDeath(4, 100f, 202)); // B 的真实死亡

        reconcile(battle, events, resolveMapping(battle, events));

        assertEquals(0.0, PlayerResultFormat.deathSec(a), 1e-9,
                "A 的 ambiguous sentinel 不得变成死亡，也不得借用 B 的证据（UNKNOWN=0）");
        assertEquals(DeathTimeSource.UNKNOWN, a.deathTimeSource);
        assertEquals(100.0, PlayerResultFormat.deathSec(b), 1e-9);
        assertEquals(DeathTimeSource.LIVE_EXACT, b.deathTimeSource);
    }

    @Test
    void survivorIsNeverTouchedEvenWithDeathEvidence() {
        final PlayerResult a = player(1001L, "A", 1, true, 0L, 300.0);
        final Battle battle = battle(300.0, a);
        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 101, 1001L),
                exactDeath(2, 50f, 101));
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(300.0, a.survivalTimeSec, 1e-9);
    }

    @Test
    void unknownHpSentinelIsNotDeathEvidence() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0);
        p.deathTimeSource = DeathTimeSource.UNKNOWN; // ReplayParser 对结算缺失玩家总是写入 UNKNOWN
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 101, 1001L),
                hp(2, 60f, 101, null, null, DecodeConfidence.PARTIAL), // 0xFFFF 语义
                hp(3, 90f, 101, null, null, DecodeConfidence.PARTIAL));
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(0.0, PlayerResultFormat.deathSec(p), 1e-9,
                "unknown HP 不得无依据变成死亡（UNKNOWN=0）");
        assertEquals(DeathTimeSource.UNKNOWN, p.deathTimeSource);
    }

    @Test
    void multipleDeathsUseLastExactAliveFalse() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, 101, 1001L));
        events.add(exactDeath(2, 60f, 101));   // 早期死亡
        events.add(exactAlive(3, 70f, 101, 2000)); // 复生
        events.add(exactDeath(4, 120f, 101)); // 最终阵亡
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(120.0, PlayerResultFormat.deathSec(p), 1e-9,
                "死亡时刻 = 最终阵亡（最后一条 alive=false），而非早期死亡");
    }

    @Test
    void evidenceLaterThanDurationIsClamped() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 0.0);
        final Battle battle = battle(218.4, p);
        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 101, 1001L),
                exactDeath(2, 250f, 101));
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(218.4, PlayerResultFormat.deathSec(p), 1e-9);
    }

    @Test
    void liveExactOverridesSettlementDeathTimeMillis() {
        final PlayerResult p = player(1001L, "A", 1, false, 111_000L, 111.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 101, 1001L),
                exactDeath(2, 128.12f, 101));
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(128.12, PlayerResultFormat.deathSec(p), 0.01,
                "LIVE_EXACT > SETTLEMENT_SECOND：live EXACT 精确阵亡时刻覆盖结算秒级时间");
        assertEquals(DeathTimeSource.LIVE_EXACT, p.deathTimeSource);
    }

    @Test
    void liveUnavailableFallsBackToSettlementSecond() {
        final PlayerResult p = player(1001L, "A", 1, false, 111_000L, 111.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = List.of(
                mappingEvent(1, 101, 1001L),
                exactAlive(2, 50f, 101, 2000)); // 仅有 alive，无最终 live 死亡证据
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(111.0, PlayerResultFormat.deathSec(p), 1e-9,
                "无有效 live EXACT + 结算 deathTimeMillis>0 → SETTLEMENT_SECOND（±0.5s 量化）");
        assertEquals(DeathTimeSource.SETTLEMENT_SECOND, p.deathTimeSource);
    }

    @Test
    void liveTerminalNegatedByLaterAliveFallsBackToSettlementSecond() {
        final PlayerResult p = player(1001L, "A", 1, false, 111_000L, 111.0);
        final Battle battle = battle(300.0, p);
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mappingEvent(1, 101, 1001L));
        events.add(exactDeath(2, 60f, 101));      // 早期死亡
        events.add(exactAlive(3, 70f, 101, 2000)); // 复生，之后无新的 alive=false
        reconcile(battle, events, resolveMapping(battle, events));
        assertEquals(111.0, PlayerResultFormat.deathSec(p), 1e-9,
                "60s 早期死亡已被 70s 复生否决；无最终 live EXACT → 回退结算 SETTLEMENT_SECOND");
        assertEquals(DeathTimeSource.SETTLEMENT_SECOND, p.deathTimeSource);
    }

    // ---- 空输入 / 无映射幂等 ----

    @Test
    void nullOrEmptyInputsAreNoOps() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 40.0);
        final Battle battle = battle(300.0, p);
        DeathTimeReconciler.reconcile(null, List.of(), BATTLE_START, emptyMapping());
        DeathTimeReconciler.reconcile(battle, null, BATTLE_START, emptyMapping());
        DeathTimeReconciler.reconcile(battle, List.of(), BATTLE_START, emptyMapping());
        assertEquals(40.0, p.survivalTimeSec, 1e-9);
    }

    @Test
    void noMappingMeansNoChange() {
        final PlayerResult p = deadPlayer(1001L, "A", 1, 40.0);
        final Battle battle = battle(300.0, p);
        // 有 alive=false 事件但权威 mapping 无该实体
        DeathTimeReconciler.reconcile(battle, List.of(exactDeath(1, 50f, 999)),
                BATTLE_START, emptyMapping());
        assertEquals(40.0, p.survivalTimeSec, 1e-9);
    }
}
