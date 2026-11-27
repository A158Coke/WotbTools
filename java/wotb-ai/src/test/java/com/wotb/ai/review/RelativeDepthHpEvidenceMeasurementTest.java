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

class RelativeDepthHpEvidenceMeasurementTest extends RelativeDepthHpEvidenceTestSupport {
    @Test
    void teamSectionEmitsMeasurementsNotVerdicts() {
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
        assertFalse(section.contains("有输出（利用队友输出）"), section);
        assertFalse(section.contains("无输出（避战）"), section);
        assertFalse(section.contains("吸血"), section);
        assertFalse(section.contains("避战"), section);
        assertFalse(section.contains("degree="), "不得输出 tactical degree");
        assertFalse(section.contains("扛线队友"), "不得输出「扛线队友」战术角色: " + section);
        assertFalse(section.contains("frontlineCapable"), "不得输出 frontlineCapable 标签");
        assertFalse(section.contains("BEHIND_LINE_HP_ADVANTAGE"), "段名必须中性化");
        assertFalse(section.contains("- account:1002("), "reference 自身不得被标");
    }

    @Test
    void teamSectionZeroObservedWithFullCoverageIsNeutralFact() {
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, false), 1, false);
        assertTrue(section.contains("observedAttackEvents=0"), section);
        assertTrue(section.contains("coverage=COMPLETE"), section);
        assertFalse(section.contains("避战"), "不得输出避战");
        assertFalse(section.contains("无输出"), "不得输出无输出结论");
    }

    @Test
    void noFlagWhenHpAdvantageTooSmall() {
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
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(pos(23, 120f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1100));
        events.add(hp(31, 30f, 11, 1000));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("vs reference account:1002"), "血量优势不足 1.2× 不得输出测量行, got: " + section);
    }

    @Test
    void baseFallbackYieldsHpRatioUnknown() {
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
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(false, true), 1, false);
        assertTrue(section.contains("hpRatio=未知"), section);
        assertTrue(section.contains("HP_RATIO_UNKNOWN"), section);
        assertFalse(section.contains("degree"), "血量不足不得出分级");
    }

    @Test
    void playerSectionOnlyRecorderAndNeutral() {
        final String section = RelativeDepthHpEvidence.renderPlayerSection(
                battle(E100, E100), recon(true, true), 1001L, false);
        assertTrue(section.contains("你") && section.contains("hpRatio=90%"), section);
        assertFalse(section.contains("- account:1002("), "个人路径不得输出队友");
        final String section2 = RelativeDepthHpEvidence.renderPlayerSection(
                battle(E100, E100), recon(true, true), 1002L, false);
        assertTrue(section2.isEmpty(), "不满足判据的录像者不得输出");
    }

    @Test
    void crossPhaseAppearanceIsSalienceNotGrade() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        for (final float t : new float[]{30f, 50f, 70f, 90f}) {
            events.add(pos(10, t, 10, -220f, 0f));
            events.add(pos(12, t, 11, -90f, 0f));
            events.add(pos(20, t, 20, 200f, 0f));
            events.add(pos(21, t, 21, 230f, 50f));
        }
        events.add(pos(44, 64f, 20, 200f, 0f));
        events.add(pos(45, 64f, 21, 230f, 50f));
        events.add(pos(46, 104f, 20, 200f, 0f));
        events.add(pos(47, 104f, 21, 230f, 50f));
        events.add(pos(48, 119f, 20, 200f, 0f));
        events.add(pos(49, 119f, 21, 230f, 50f));
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
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, true);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertTrue(section.contains("coverage=PARTIAL"), section);
        assertFalse(section.contains("有输出（利用队友输出）"), "partial 下不得给出完整输出结论");
    }
}
