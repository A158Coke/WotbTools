package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** HP measurement and evidence coverage behavior. */
class RelativeDepthHpEvidenceMeasurementTest extends RelativeDepthHpEvidenceTestSupport {
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
}
