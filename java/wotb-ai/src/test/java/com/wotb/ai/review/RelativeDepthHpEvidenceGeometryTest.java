package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Geometric reference and incomplete-position behavior. */
class RelativeDepthHpEvidenceGeometryTest extends RelativeDepthHpEvidenceTestSupport {
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
        pl.settlementLifeTimeSec = 10;
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
        // P0-1：canonical AoI gap 需要 Type4 leave。enemy 在 t=20 离开 → segment [10,20) 关闭 →
        // opening 末（45）位于 UNKNOWN_AOI gap → LAST_KNOWN（fail-closed，不产生 exact 距离）。
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(55, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(56, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        // 交火 t=30 → opening [0,45] / mid [45,85] / late [85,100]：enemy 全程位于 gap
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
