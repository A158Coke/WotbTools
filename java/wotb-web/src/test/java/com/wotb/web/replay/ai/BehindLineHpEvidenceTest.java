package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.EntryHpSource;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** BehindLineHpEvidence：身后血量/位置优势确定性测量（中性，不输出吸血/避战/利用队友/degree）。 */
class BehindLineHpEvidenceTest {

    private static final String MAP = "holland";
    /** 真实 tankopedia id：9489=E 100(HEAVY)、9297=FV215b 183(TD)。 */
    private static final long E100 = 9489L;
    private static final long FV215B183 = 9297L;

    private static PlayerResult player(final long accountId, final int team, final long tankId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        // hp ratio 分母只允许已证明的进场满血（OBSERVED_EXACT）
        p.entryHpSource = EntryHpSource.OBSERVED_EXACT;
        p.entryHp = 2000;
        p.observedMaxHp = 2000;
        p.survived = true;
        return p;
    }

    private static PositionChangedEvent pos(final int sequence, final float rawClock,
                                            final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    private static HealthChangedEvent hp(final int sequence, final float rawClock,
                                         final int entityId, final int currentHealth) {
        return new HealthChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 7,
                DecodeConfidence.EXACT, entityId, currentHealth, null, true);
    }

    private static DamageEvent dmg(final int sequence, final float rawClock,
                                   final int attackerEid, final int victimEid) {
        return new DamageEvent(sequence, new ReplayTimestamp(rawClock, null), 8,
                DecodeConfidence.EXACT, attackerEid, victimEid, null, null, 200, false);
    }

    /** 事件流：双方各 2 车。本队 1001(HEAVY) 靠后高血、1002(HEAVY) 靠前低血；敌方 2001/2002 靠右。 */
    private static ReplayReconstruction recon(final boolean withHp, final boolean withDamage) {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 位置：本队靠左（1001 更靠后=离敌更远），敌方靠右
        events.add(pos(10, 40f, 10, -220f, 0f));   // 1001 t=20
        events.add(pos(11, 42f, 10, -210f, 0f));   // 1001 t=22
        events.add(pos(12, 40f, 11, -90f, 0f));    // 1002 t=20（前排）
        events.add(pos(13, 42f, 11, -80f, 0f));    // 1002 t=22
        events.add(pos(20, 40f, 20, 200f, 0f));    // 2001
        events.add(pos(21, 40f, 21, 230f, 50f));   // 2002
        if (withHp) {
            // 1001 血量 1800/2000=90%；1002 血量 1000/2000=50%（1001 比率 1.8× ≥ 1.2×）
            events.add(hp(30, 30f, 10, 1800));
            events.add(hp(31, 30f, 11, 1000));
        }
        if (withDamage) {
            // 1001 作为攻击者输出 2 次（有输出）
            events.add(dmg(40, 50f, 10, 20));
            events.add(dmg(41, 60f, 10, 21));
        }
        return new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
    }

    private static Battle battle(final long ally1Tank, final long ally2Tank) {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, ally1Tank),
                player(1002L, 1, ally2Tank),
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        return battle;
    }

    @Test
    void teamSectionEmitsMeasurementsNotVerdicts() {
        // 1001(HEAVY) 血量 90% vs 扛线队友 1002 50%（1.8×）且距敌更远，有输出 → 只输出测量
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, false);
        assertTrue(section.contains("=== BEHIND_LINE_HP_ADVANTAGE"), section);
        assertTrue(section.contains("account:1001"), section);
        assertTrue(section.contains("hp=90%"), section);
        assertTrue(section.contains("hp=50%"), section);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertTrue(section.contains("coverage=COMPLETE"), section);
        // 战术 verdict 词汇必须消失
        assertFalse(section.contains("有输出（利用队友输出）"), section);
        assertFalse(section.contains("无输出（避战）"), section);
        assertFalse(section.contains("吸血"), section);
        assertFalse(section.contains("避战"), section);
        assertFalse(section.contains("degree="), "不得输出 tactical degree");
        // 1002 是扛线队友（距敌最近），自身不满足「距敌更远」→ 不标
        assertFalse(section.contains("- account:1002 hp="), "扛线队友自身不得被标");
    }

    @Test
    void teamSectionZeroObservedWithFullCoverageIsNeutralFact() {
        // 无输出（完整覆盖）→ 只报 observedAttackEvents=0 coverage=COMPLETE，不判「避战」
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, false), 1, false);
        assertTrue(section.contains("observedAttackEvents=0"), section);
        assertTrue(section.contains("coverage=COMPLETE"), section);
        assertFalse(section.contains("避战"), "不得输出避战");
        assertFalse(section.contains("无输出"), "不得输出无输出结论");
    }

    @Test
    void noFlagWhenHpAdvantageTooSmall() {
        // 1001 血量 60%、1002 50% → 比率 1.2× 恰好达标？改为 55% → 1.1× 不达标：构造 hp 事件覆盖
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1100));  // 55%
        events.add(hp(31, 30f, 11, 1000));  // 50%
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("vs 扛线队友"), "血量优势不足 1.2× 不得输出测量行, got: " + section);
    }

    @Test
    void baseFallbackYieldsHpAdvantageUnknown() {
        // BASE_FALLBACK（进场满血未证明）：hp ratio 不可用 → 中性 HP_ADVANTAGE_UNKNOWN
        final Battle b = battle(E100, E100);
        for (final PlayerResult p : b.players) {
            p.entryHpSource = EntryHpSource.BASE_FALLBACK;
            p.entryHp = null;
        }
        final String section = BehindLineHpEvidence.renderTeamSection(b, recon(true, true), 1, false);
        assertTrue(section.contains("HP_ADVANTAGE_UNKNOWN"), section);
        assertFalse(section.contains("避战"), section);
        assertFalse(section.contains("degree"), "血量不可用不得出分级: " + section);
    }

    @Test
    void unknownYieldsHpAdvantageUnknown() {
        final Battle b = battle(E100, E100);
        for (final PlayerResult p : b.players) {
            p.entryHpSource = EntryHpSource.UNKNOWN;
            p.entryHp = null;
        }
        final String section = BehindLineHpEvidence.renderTeamSection(b, recon(true, true), 1, false);
        assertTrue(section.contains("HP_ADVANTAGE_UNKNOWN"), section);
        assertFalse(section.contains("避战"), section);
    }

    @Test
    void highObservedMaxHpWithoutProvenEntryNeverFeedsRatio() {
        // observedMaxHp 很高（5000）但 entryHp 未证明：不得偷偷拿 observedMaxHp 算 ratio
        final Battle b = battle(E100, E100);
        for (final PlayerResult p : b.players) {
            p.observedMaxHp = 5000;
            p.entryHpSource = EntryHpSource.BASE_FALLBACK;
            p.entryHp = null;
        }
        final String section = BehindLineHpEvidence.renderTeamSection(b, recon(true, true), 1, false);
        assertFalse(section.contains("hp=90%"), "不得用 observedMaxHp 作 ratio 分母: " + section);
        assertTrue(section.contains("HP_ADVANTAGE_UNKNOWN"), section);
    }

    @Test
    void tdIsNotFlaggedEvenWhenBehind() {
        // 1001 换成 TD：不可扛线 → 即使靠后高血也不标（TD 后排是正常分工）
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(FV215B183, E100), recon(true, true), 1, false);
        assertTrue(section.isEmpty(), "TD 不可扛线，不得纳入测量");
    }

    @Test
    void degradedWhenHpUnavailable() {
        // 无 HP 采样 → 降级行（仅位置+输出事实），不产出 degree
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon(false, true), 1, false);
        assertTrue(section.contains("hp=未知"), section);
        assertTrue(section.contains("HP_ADVANTAGE_UNKNOWN"), section);
        assertFalse(section.contains("degree"), "血量不足不得出分级");
    }

    @Test
    void playerSectionOnlyRecorderAndNeutral() {
        // 录像者=1001：个人路径输出「你」；队友 1002 触发也不得出现在个人段
        final String section = BehindLineHpEvidence.renderPlayerSection(
                battle(E100, E100), recon(true, true), 1001L, false);
        assertTrue(section.contains("你 hp=90%"), section);
        assertFalse(section.contains("- account:1002 hp="), "个人路径不得输出队友");
        // 录像者=1002（扛线队友，不满足判据）→ 空
        final String section2 = BehindLineHpEvidence.renderPlayerSection(
                battle(E100, E100), recon(true, true), 1002L, false);
        assertTrue(section2.isEmpty(), "不满足判据的录像者不得输出");
    }

    @Test
    void crossPhaseAppearanceIsSalienceNotGrade() {
        // 多阶段命中（opening+mid+late 各一次同判据）→ 跨阶段出现次数（中性 salience）
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 位置：1001 全程靠后，1002 靠前；敌方靠右
        for (final float t : new float[]{30f, 50f, 70f, 90f}) {
            events.add(pos(10, t, 10, -220f, 0f));
            events.add(pos(12, t, 11, -90f, 0f));
            events.add(pos(20, t, 20, 200f, 0f));
            events.add(pos(21, t, 21, 230f, 50f));
        }
        events.add(hp(30, 25f, 10, 1800));
        events.add(hp(31, 25f, 11, 1000));
        events.add(hp(32, 45f, 10, 1700));
        events.add(hp(33, 45f, 11, 900));
        events.add(hp(34, 65f, 10, 1600));
        events.add(hp(35, 65f, 11, 800));
        events.add(hp(36, 85f, 10, 1500));
        events.add(hp(37, 85f, 11, 700));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.contains("跨阶段出现"), section);
        assertTrue(section.contains("account:1001 在 "), section);
        assertFalse(section.contains("degree（跨阶段聚合"), "不得输出 degree 聚合");
        assertFalse(section.contains("轻度"), "不得输出战术分级");
    }

    @Test
    void partialDamageCoverageWithZeroObservedNeverSaysAvoidance() {
        // OBSERVED_DAMAGE_IS_PARTIAL + 0 observed DamageEvent → 不得出现「避战」，只写 observedAttackEvents + coverage=PARTIAL
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, false), 1, true);
        assertTrue(section.contains("observedAttackEvents=0"), section);
        assertTrue(section.contains("coverage=PARTIAL"), section);
        // 否定文案含「不得推断避战」字样，精确检查旧固定句式
        assertFalse(section.contains("无输出（避战）"), "partial 覆盖下 0 个已观测事件不得推断无输出/避战");
        assertFalse(section.contains("有输出（利用队友输出）"), "partial 覆盖下不得给出完整输出结论");
        assertFalse(section.contains("degree"), "partial + 0 observed 不得生成 degree");
    }

    @Test
    void partialDamageCoverageWithObservedEventsReportsCountOnly() {
        // partial + 有 observed DamageEvent → 可写「观察到 N 次」，但不得声称事件覆盖完整
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, true);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertTrue(section.contains("coverage=PARTIAL"), section);
        assertFalse(section.contains("有输出（利用队友输出）"), "partial 下不得给出完整输出结论");
    }

    @Test
    void lightTankNearestIsNotCarrierTeammate() {
        // LT 距敌最近 → 不得被称为扛线队友；X(HEAVY) 距敌更远时不得因 LT 距离差产生判定
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, 19537L),   // Vickers Light (LT)
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));   // 1001 HEAVY 靠后
        events.add(pos(12, 40f, 11, -60f, 0f));    // 1002 LT 最靠前（距敌最近）
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertFalse(section.contains("vs 扛线队友 account:1002"), "LT 不得被当作扛线队友, got: " + section);
    }

    @Test
    void paperTdNearestIsNotCarrierTeammate() {
        // 纸 TD（FV215b 183，armor=LOW）距敌最近 → 不得成为 carrier；本队无合格 carrier → 无 BehindLine 判定
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, FV215B183),   // 纸 TD 靠前
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));   // 1001 HEAVY 靠后
        events.add(pos(12, 40f, 11, -60f, 0f));    // 1002 纸 TD 最靠前
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertFalse(section.contains("vs 扛线队友 account:1002"), "纸 TD 不得成为 carrier, got: " + section);
    }

    @Test
    void qualifiedFrontlineTeammateSelected() {
        // HEAVY 在前、HEAVY 在后 → 正常选择 HEAVY 为扛线队友并输出测量
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, false);
        assertTrue(section.contains("vs 扛线队友 account:1002"), "合格 HEAVY 应被选为扛线队友, got: " + section);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertFalse(section.contains("利用队友输出"), section);
    }

    @Test
    void noCarrierTeammateYieldsNoBehindLineVerdict() {
        // 本队只有 X 一辆可扛线车，其余为 LT/纸 TD → 无合格 carrier → 无 BehindLine 判定
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, 19537L),   // LT
                player(1003L, 1, FV215B183),// 纸 TD
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 12, 1003L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(5, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(11, 40f, 11, -90f, 0f));
        events.add(pos(12, 40f, 12, -80f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        events.add(hp(32, 30f, 12, 500));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertFalse(section.contains("vs 扛线队友"), "无合格 carrier 不得产生 BehindLine 判定, got: " + section);
    }

    @Test
    void deadFrontlineCannotBeCarrier() {
        // 1002(HEAVY) 距敌最近但已阵亡（deathSec=10，phase.end 后）→ 不得成为扛线队友
        final Battle battle = battle(E100, E100);
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1002L) {
                pl.survived = false;
                pl.deathTimeMillis = 10_000L;
            }
        }
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle, recon(true, true), 1, false);
        assertFalse(section.contains("vs 扛线队友 account:1002"), "已阵亡 HEAVY 不得成为 carrier, got: " + section);
    }

    @Test
    void enemyPositionReferenceIncompleteYieldsNoMeasurements() {
        // 敌方 2 车中 2002 无位置参考 → 最近观测敌方 ≠ 真实最近敌方 → 本阶段禁止输出 BehindLine 测量
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));   // 2001 有位置
        // 2002 无位置（仅 mapping）→ enemyRef=1/2 → 不完整
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("vs 扛线队友"), "敌方位置参考不完整时不得产生 BehindLine 判定, got: " + section);
    }

    @Test
    void enemyPositionsCompletelyMissingYieldsNoVerdict() {
        // 敌方完全无位置 → 无距离参考 → 无 BehindLine 判定
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.isEmpty() || !section.contains("vs 扛线队友"),
                "敌方完全无位置时不得输出 BehindLine 判定, got: " + section);
    }

    @Test
    void nullAndSentinelHpEventsAreSkippedWithoutException() {
        // currentHealth=null（自动拆箱 NPE 回归）与 sentinel（65533=0xFFFD、65535=0xFFFF）事件必须被跳过
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(new HealthChangedEvent(32, new ReplayTimestamp(35f, null), 7,
                DecodeConfidence.EXACT, 10, null, null, null));
        events.add(new HealthChangedEvent(33, new ReplayTimestamp(36f, null), 7,
                DecodeConfidence.EXACT, 10, 65533, null, true));
        events.add(new HealthChangedEvent(34, new ReplayTimestamp(37f, null), 7,
                DecodeConfidence.EXACT, 10, 65535, null, true));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.contains("vs 扛线队友 account:1002"),
                "正常正 HP 判定不得被 null/sentinel 破坏, got: " + section);
    }

    @Test
    void zeroHpAllowedAsDeathTerminalWithoutException() {
        // currentHealth=0（死亡终态）必须被允许进入 hpSamples：作为最后采样时 hpRatio=0 → 中性输出
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(hp(32, 50f, 10, 0));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = BehindLineHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("利用队友输出"), "0 死亡终态后不得再判吸血/避战");
    }
}
