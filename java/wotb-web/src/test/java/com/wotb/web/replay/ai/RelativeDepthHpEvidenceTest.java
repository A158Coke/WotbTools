package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RelativeDepthHpEvidence：相对纵深/血量确定性测量（中性，不输出吸血/避战/利用队友/degree；
 * reference 为纯几何选择，不输出战术角色标签）。
 */
class RelativeDepthHpEvidenceTest {

    private static final String MAP = "holland";
    /**
     * 真实 tankopedia id：9489=E 100(HEAVY)、9297=FV215b 183(TD)、19537=Vickers Light(LT)。
     */
    private static final long E100 = 9489L;
    private static final long FV215B183 = 9297L;
    private static final long VICKERS_LIGHT = 19537L;

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

    /**
     * 事件流：双方各 2 车。本队 1001(HEAVY) 靠后高血、1002(HEAVY) 靠前低血；敌方 2001/2002 靠右。
     */
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
        events.add(pos(12, 40f, 11, -90f, 0f));    // 1002 t=20（前排=reference）
        events.add(pos(13, 42f, 11, -80f, 0f));    // 1002 t=22
        events.add(pos(20, 40f, 20, 200f, 0f));    // 2001
        events.add(pos(21, 40f, 21, 230f, 50f));   // 2002
        // 敌方 phase 末保持 CURRENT：opening=[0,45]（有交火）用 t=44；无交火时 opening=[0,100] 用 t=100。
        // enemy 位置 ≥ 当前阈值内才算 current，不能只开局有位置（enemy stale → LAST_KNOWN → fail-close）
        events.add(pos(22, 64f, 20, 200f, 0f));    // 2001 t=44
        events.add(pos(23, 64f, 21, 230f, 50f));   // 2002 t=44
        events.add(pos(24, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(25, 120f, 21, 230f, 50f));  // 2002 t=100
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
        // 1001(HEAVY) 血量 90% vs reference 1002 50%（1.8×）且距敌更远，有输出 → 只输出测量
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, false);
        assertTrue(section.contains("=== RELATIVE_DEPTH_HP_MEASUREMENT"), section);
        assertTrue(section.contains("account:1001"), section);
        assertTrue(section.contains("hpRatio=90%"), section);
        assertTrue(section.contains("hpRatio=50%"), section);
        assertTrue(section.contains("vs reference account:1002"), "reference 必须是中性命名: " + section);
        assertTrue(section.contains("memberDist="), section);
        assertTrue(section.contains("referenceDist="), section);
        assertTrue(section.contains("relativeDepthM=+"), section);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertTrue(section.contains("coverage=COMPLETE"), section);
        // 战术 verdict 词汇必须消失
        assertFalse(section.contains("有输出（利用队友输出）"), section);
        assertFalse(section.contains("无输出（避战）"), section);
        assertFalse(section.contains("吸血"), section);
        assertFalse(section.contains("避战"), section);
        assertFalse(section.contains("degree="), "不得输出 tactical degree");
        assertFalse(section.contains("扛线队友"), "不得输出「扛线队友」战术角色: " + section);
        assertFalse(section.contains("frontlineCapable"), "不得输出 frontlineCapable 标签");
        assertFalse(section.contains("BEHIND_LINE_HP_ADVANTAGE"), "段名必须中性化");
        // 1002 是 reference（距敌最近），自身不满足「距敌更远」→ 不标
        assertFalse(section.contains("- account:1002("), "reference 自身不得被标");
    }

    @Test
    void teamSectionZeroObservedWithFullCoverageIsNeutralFact() {
        // 无输出（完整覆盖）→ 只报 observedAttackEvents=0 coverage=COMPLETE，不判「避战」
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, false), 1, false);
        assertTrue(section.contains("observedAttackEvents=0"), section);
        assertTrue(section.contains("coverage=COMPLETE"), section);
        assertFalse(section.contains("避战"), "不得输出避战");
        assertFalse(section.contains("无输出"), "不得输出无输出结论");
    }

    @Test
    void noFlagWhenHpAdvantageTooSmall() {
        // 1001 血量 55%、1002 50% → 比率 1.1× 不达标：构造 hp 事件覆盖
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
        // 无交火 → opening=[0,100]；敌方 phase 末（t=100）保持 CURRENT（1.1× 判定才真正生效）
        events.add(pos(22, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(23, 120f, 21, 230f, 50f));  // 2002 t=100
        events.add(hp(30, 30f, 10, 1100));  // 55%
        events.add(hp(31, 30f, 11, 1000));  // 50%
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("vs reference account:1002"), "血量优势不足 1.2× 不得输出测量行, got: " + section);
    }

    @Test
    void baseFallbackYieldsHpRatioUnknown() {
        // BASE_FALLBACK（进场满血未证明）：hp ratio 不可用 → 中性 HP_RATIO_UNKNOWN
        final Battle b = battle(E100, E100);
        for (final PlayerResult p : b.players) {
            p.entryHpSource = EntryHpSource.BASE_FALLBACK;
            p.entryHp = null;
        }
        final String section = RelativeDepthHpEvidence.renderTeamSection(b, recon(true, true), 1, false);
        assertTrue(section.contains("HP_RATIO_UNKNOWN"), section);
        assertFalse(section.contains("避战"), section);
        assertFalse(section.contains("degree"), "血量不可用不得出分级: " + section);
        assertFalse(section.contains("HP_ADVANTAGE_UNKNOWN"), "不得残留旧标记");
    }

    @Test
    void unknownYieldsHpRatioUnknown() {
        final Battle b = battle(E100, E100);
        for (final PlayerResult p : b.players) {
            p.entryHpSource = EntryHpSource.UNKNOWN;
            p.entryHp = null;
        }
        final String section = RelativeDepthHpEvidence.renderTeamSection(b, recon(true, true), 1, false);
        assertTrue(section.contains("HP_RATIO_UNKNOWN"), section);
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
        final String section = RelativeDepthHpEvidence.renderTeamSection(b, recon(true, true), 1, false);
        assertFalse(section.contains("hpRatio=90%"), "不得用 observedMaxHp 作 ratio 分母: " + section);
        assertTrue(section.contains("HP_RATIO_UNKNOWN"), section);
    }

    @Test
    void tdBehindIsMeasuredWithProfileFactsNotVerdict() {
        // 1001 换成 TD：纯几何 reference（1002 HEAVY），1001 靠后高血 → 测量行照常输出（TD profile 作为静态事实），
        // 是否合理由 LLM 判断——Backend 不再预判「TD 天然后排」
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(FV215B183, E100), recon(true, true), 1, false);
        assertTrue(section.contains("account:1001"), "TD 靠后高血也应输出测量行: " + section);
        assertTrue(section.contains("TANK_DESTROYER"), "测量行必须带 TD 静态 profile 事实");
        assertTrue(section.contains("vs reference account:1002"), section);
        assertFalse(section.contains("吸血"), section);
        assertFalse(section.contains("避战"), section);
        assertFalse(section.contains("扛线队友"), section);
    }

    @Test
    void degradedWhenHpUnavailable() {
        // 无 HP 采样 → 降级行（仅位置+输出事实），不产出 degree
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(false, true), 1, false);
        assertTrue(section.contains("hpRatio=未知"), section);
        assertTrue(section.contains("HP_RATIO_UNKNOWN"), section);
        assertFalse(section.contains("degree"), "血量不足不得出分级");
    }

    @Test
    void playerSectionOnlyRecorderAndNeutral() {
        // 录像者=1001：个人路径输出「你」；队友 1002 触发也不得出现在个人段
        final String section = RelativeDepthHpEvidence.renderPlayerSection(
                battle(E100, E100), recon(true, true), 1001L, false);
        assertTrue(section.contains("你") && section.contains("hpRatio=90%"), section);
        assertFalse(section.contains("- account:1002("), "个人路径不得输出队友");
        // 录像者=1002（reference，不满足判据）→ 空
        final String section2 = RelativeDepthHpEvidence.renderPlayerSection(
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
        // 位置：1001 全程靠后，1002 靠前；敌方靠右（t=10/30/50/70）
        for (final float t : new float[]{30f, 50f, 70f, 90f}) {
            events.add(pos(10, t, 10, -220f, 0f));
            events.add(pos(12, t, 11, -90f, 0f));
            events.add(pos(20, t, 20, 200f, 0f));
            events.add(pos(21, t, 21, 230f, 50f));
        }
        // 敌方每阶段末保持 CURRENT（opening 末 t=44 / mid 末 t=84 / late 末 t=99；age ≤ 5s）：
        // 交火 t=30 → opening [0,45] / mid [45,85] / late [85,100]
        events.add(pos(44, 64f, 20, 200f, 0f));    // 2001 t=44
        events.add(pos(45, 64f, 21, 230f, 50f));   // 2002 t=44
        events.add(pos(46, 104f, 20, 200f, 0f));   // 2001 t=84
        events.add(pos(47, 104f, 21, 230f, 50f));  // 2002 t=84
        events.add(pos(48, 119f, 20, 200f, 0f));   // 2001 t=99
        events.add(pos(49, 119f, 21, 230f, 50f));  // 2002 t=99
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
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.contains("跨阶段出现"), section);
        assertTrue(section.contains("account:1001 在 "), section);
        assertFalse(section.contains("degree（跨阶段聚合"), "不得输出 degree 聚合");
        assertFalse(section.contains("轻度"), "不得输出战术分级");
    }

    @Test
    void partialDamageCoverageWithZeroObservedNeverSaysAvoidance() {
        // OBSERVED_DAMAGE_IS_PARTIAL + 0 observed DamageEvent → 不得出现「避战」，只写 observedAttackEvents + coverage=PARTIAL
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, false), 1, true);
        assertTrue(section.contains("observedAttackEvents=0"), section);
        assertTrue(section.contains("coverage=PARTIAL"), section);
        assertFalse(section.contains("无输出（避战）"), "partial 覆盖下 0 个已观测事件不得推断无输出/避战");
        assertFalse(section.contains("有输出（利用队友输出）"), "partial 覆盖下不得给出完整输出结论");
        assertFalse(section.contains("degree"), "partial + 0 observed 不得生成 degree");
    }

    @Test
    void partialDamageCoverageWithObservedEventsReportsCountOnly() {
        // partial + 有 observed DamageEvent → 可写「观察到 N 次」，但不得声称事件覆盖完整
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, true);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertTrue(section.contains("coverage=PARTIAL"), section);
        assertFalse(section.contains("有输出（利用队友输出）"), "partial 下不得给出完整输出结论");
    }

    @Test
    void lightTankNearestIsGeometricReference() {
        // LT 距敌最近 → 成为 reference（纯几何，不按坦克类型排除）；X(HEAVY) 距敌更远且高血 → 输出测量行（附双方 profile 事实）
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, VICKERS_LIGHT),   // LT 靠前
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
        // 无交火 → opening=[0,100]；敌方 phase 末保持 CURRENT
        events.add(pos(22, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(23, 120f, 21, 230f, 50f));  // 2002 t=100
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertTrue(section.contains("vs reference account:1002"), "LT 应作为纯几何 reference: " + section);
        assertTrue(section.contains("LIGHT"), "reference 行必须带 LT 静态 profile 事实");
        assertFalse(section.contains("扛线队友"), "不得把 reference 命名为战术角色");
    }

    @Test
    void paperTdNearestIsGeometricReference() {
        // 纸 TD 距敌最近 → 同样成为 reference（纯几何）；X(HEAVY) 靠后高血 → 输出测量行
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
        // 无交火 → opening=[0,100]；敌方 phase 末保持 CURRENT
        events.add(pos(22, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(23, 120f, 21, 230f, 50f));  // 2002 t=100
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertTrue(section.contains("vs reference account:1002"), "纸 TD 应作为纯几何 reference: " + section);
        assertFalse(section.contains("扛线队友"), section);
    }

    @Test
    void referenceSelectedByPureGeometry() {
        // HEAVY 在前、HEAVY 在后 → reference=距敌最近的 1002；1001 输出测量行
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, false);
        assertTrue(section.contains("vs reference account:1002"), "几何 reference 应为 1002, got: " + section);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertFalse(section.contains("利用队友输出"), section);
    }

    @Test
    void noReferenceYieldsNoMeasurement() {
        // 本队只有 X 一辆有位置参考，其余成员位置不足 → 无 reference → 无测量行
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, VICKERS_LIGHT),
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
        // 只有 1001 有位置；1002 无位置 → meanByAccount.size()=1 < 2 → 无测量
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertFalse(section.contains("vs reference"), "无 reference 不得产生测量行, got: " + section);
    }

    @Test
    void deadMemberCannotBeReference() {
        // 1002(HEAVY) 距敌最近但已阵亡（deathSec=10，phase.end 后）→ 不得成为 reference
        final Battle battle = battle(E100, E100);
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1002L) {
                pl.survived = false;
                pl.deathTimeMillis = 10_000L;
            }
        }
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon(true, true), 1, false);
        assertFalse(section.contains("vs reference account:1002"), "已阵亡 HEAVY 不得成为 reference, got: " + section);
    }

    @Test
    void enemyPositionReferenceIncompleteYieldsNoMeasurements() {
        // 敌方 2 车中 2002 无位置参考 → 最近观测敌方 ≠ 真实最近敌方 → 本阶段禁止输出测量
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
        // 无交火 → opening=[0,100]；2001 phase 末保持 CURRENT（排除 stale 干扰），2002 仍无位置
        events.add(pos(22, 120f, 20, 200f, 0f));  // 2001 t=100
        // 2002 无位置（仅 mapping）→ enemyRef=1/2 → 不完整
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("vs reference"), "敌方位置参考不完整时不得产生测量, got: " + section);
    }

    @Test
    void enemyPositionsCompletelyMissingYieldsNoVerdict() {
        // 敌方完全无位置 → 无距离参考 → 无测量
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
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.isEmpty() || !section.contains("vs reference"),
                "敌方完全无位置时不得输出测量, got: " + section);
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
        // 无交火 → opening=[0,100]；敌方 phase 末保持 CURRENT
        events.add(pos(22, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(23, 120f, 21, 230f, 50f));  // 2002 t=100
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
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.contains("vs reference account:1002"),
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
        // 无交火 → opening=[0,100]；敌方 phase 末保持 CURRENT（0 死亡终态路径才真正生效）
        events.add(pos(22, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(23, 120f, 21, 230f, 50f));  // 2002 t=100
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(hp(32, 50f, 10, 0));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("利用队友输出"), "0 死亡终态后不得再判吸血/避战");
    }

    @Test
    void openingRearTercileIsPureGeometryForAllMembers() {
        // opening 附加几何事实：最靠后三分位成员照常输出（含 TD/LT，不按坦克类型排除），附静态 profile 事实
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));   // 1001 TD 靠后
        events.add(pos(12, 40f, 11, -90f, 0f));    // 1002 靠前
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        // 无 HP/伤害事件 → opening=[0,100]；敌方 phase 末保持 CURRENT（几何事实路径才成立）
        events.add(pos(22, 120f, 20, 200f, 0f));   // 2001 t=100
        events.add(pos(23, 120f, 21, 230f, 50f));  // 2002 t=100
        // 无 HP/伤害事件 → 走 opening 几何事实路径
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(FV215B183, E100), recon, 1, false);
        assertTrue(section.contains("account:1001"), "TD 靠后也应输出 opening 几何事实: " + section);
        assertTrue(section.contains("最靠后三分位"), section);
        assertTrue(section.contains("TANK_DESTROYER"), "必须附 TD 静态 profile 事实");
        assertFalse(section.contains("未上前线"), "不得输出「未上前线」战术判定");
        assertFalse(section.contains("frontlineCapable"), section);
    }

    @Test
    void staleEnemyDoesNotProduceExactRelativeDepthDistance() {
        // enemy 最后位置 t=10，phaseEnd（opening 末 45）明显 >15，phase 内无新位置
        // → enemy LAST_KNOWN 不得满足 current completeness，不得产生 memberDist/referenceDist/relativeDepthM
        //   exact 距离（fail-close；不得 future-leak 成「当前精确距离」）。
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));   // 1001 t=20
        events.add(pos(12, 40f, 11, -90f, 0f));    // 1002 t=20
        events.add(pos(20, 30f, 20, 200f, 0f));    // 2001 t=10（stale）
        events.add(pos(21, 30f, 21, 230f, 50f));   // 2002 t=10（stale）
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        // 交火 t=30 → opening [0,45] / mid [45,85] / late [85,100]：enemy 全程 stale
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.isEmpty(), "stale enemy 不得产生 exact RelativeDepth 测量，got: " + section);
        assertFalse(section.contains("memberDist="), "不得输出 memberDist: " + section);
        assertFalse(section.contains("referenceDist="), "不得输出 referenceDist: " + section);
        assertFalse(section.contains("relativeDepthM="), "不得输出 relativeDepthM: " + section);
        assertFalse(section.contains("vs reference"), "不得输出 reference 测量行: " + section);
    }
}
