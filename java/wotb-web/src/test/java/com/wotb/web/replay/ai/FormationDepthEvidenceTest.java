package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
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

/**
 * FormationDepthEvidence：阵型深度（前后排）与控制区域确定性证据段渲染。
 */
class FormationDepthEvidenceTest {

    private static final String MAP = "holland";

    /**
     * 真实 tankopedia id（tier10）：9489=E 100(HEAVY)、9297=FV215b 183(TD)、385=Progetto 65(MEDIUM)、19537=Vickers Light(LT)。
     */
    private static PlayerResult player(final long accountId, final int team, final String nickname, final long tankId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.nickname = nickname;
        p.tankId = tankId;
        p.survived = true;
        return p;
    }


    private static PositionChangedEvent pos(final int sequence, final float rawClock,
                                            final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    /**
     * 双方 4 车，各自集中在不同区域；本队 1001 更靠敌方、1002 靠后。
     */
    private static ReplayReconstruction reconWithPositions(final Float battleStart) {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 本队（靠左，holland 界内）：1001 更靠敌方（前排），1002 靠后
        events.add(pos(10, 40f, 10, -100f, 0f));  // 1001 t=20
        events.add(pos(11, 42f, 10, -90f, 0f));   // 1001 t=22
        events.add(pos(12, 40f, 11, -200f, 0f));  // 1002 t=20
        events.add(pos(13, 42f, 11, -190f, 0f));  // 1002 t=22
        // 敌方（靠右，与本体不同九宫格区域）
        events.add(pos(20, 40f, 20, 200f, 0f));   // 2001 t=20
        events.add(pos(21, 42f, 20, 210f, 0f));   // 2001 t=22
        events.add(pos(22, 40f, 21, 230f, 50f));  // 2002 t=20
        events.add(pos(23, 42f, 21, 235f, 50f));  // 2002 t=22
        return new ReplayReconstruction(null, null, 100f, battleStart, List.of(),
                events, List.of(), null, null, null);
    }

    private static Battle battle() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, "AllyFront", 9489L),
                player(1002L, 1, "AllyBack", 9297L), // TD：本队 HEAVY+TD → 有前排有后排
                player(2001L, 2, "EnemyA", 9297L),
                player(2002L, 2, "EnemyB", 9297L));
        return battle;
    }


    @Test
    void rendersFrontMidBackAndControlledRegions() {
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("=== FORMATION_DEPTH"), section);
        assertTrue(section.contains("phase=opening"), section);
        // 1001 更靠敌方 → 前排；1002 靠后 → 后排（account:<accountId> 与阵型簇一致）
        assertTrue(section.contains("frontLine=account:1001"), section);
        assertTrue(section.contains("backLine=account:1002"), section);
        // profile-aware：阵容结构行 + frontLine 带 tank profile 标注（HEAVY）
        assertTrue(section.contains("lineupStructure=totalVehicles="), section);
        assertTrue(section.contains("/frontlineCapable="), section);
        assertTrue(section.contains("frontLine=account:1001(HEAVY"), section);
        // 双方驻留不同区域 → REGION_COVERAGE_MEASUREMENTS 输出双方位置存在与分数
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ownPositionPresence="), section);
        assertTrue(section.contains("enemyPositionPresence="), section);
        assertTrue(section.contains("ownWeightedCoverageScore="), section);
        assertTrue(section.contains("coverageCompleteness="), section);
        // 不得输出 own/contested/enemy 权威控制权标签
        assertFalse(section.contains("controlRegions own="), "不得输出 controlRegions own 权威标签");
        assertFalse(section.contains("controlRegions enemy="), "不得输出 controlRegions enemy 权威标签");
        assertFalse(section.contains("controlRegions contested="), "不得输出 controlRegions contested 权威标签");
    }

    @Test
    void emptyWithoutReconOrMapping() {
        assertTrue(FormationDepthEvidence.renderSection(battle(), null, 1, MAP).isEmpty());
        final Battle empty = battle();
        empty.players = List.of();
        assertTrue(FormationDepthEvidence.renderSection(empty, reconWithPositions(20f), 1, MAP).isEmpty());
    }

    @Test
    void enemyPositionsMissingFailsClosedControlRegions() {
        // 敌方完全没有位置参考 → 禁止输出 own/enemy controlRegions 强结论（敌方无位置 ≠ 敌方不存在），
        // 输出 POSITION_COVERAGE_INSUFFICIENT + positionalPresence 纯事实
        final ReplayReconstruction recon = reconWithPositions(20f);
        final Battle battle = battle();
        final List<ReplayEvent> filtered = recon.events().stream()
                .filter(e -> !(e instanceof ParticipantMappingEvent m)
                        || (m.entityId() != 20 && m.entityId() != 21))
                .toList();
        final ReplayReconstruction ownOnly = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), new ArrayList<>(filtered), List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, ownOnly, 1, MAP);
        assertTrue(section.contains("POSITION_COVERAGE_INSUFFICIENT"), section);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ownPositionPresence=GRID_REGION_"), section);
        assertFalse(section.contains("ownWeightedCoverageScore="), "敌方无位置参考时不得输出分数对比");
        assertFalse(section.contains("frontLine="), "敌方无位置观测时不得输出前后排");
    }


    @Test
    void noFrontlineWhenAllBacklineType() {
        // 本队全 TD（FV215b 183）：无前线型车辆 → 不产 frontLine 名单，输出 noFrontlineVehicle + 几何参考
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9297L),
                player(1002L, 1, "AllyB", 9297L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("noFrontlineVehicle=本阶段阵容无前线型车辆"), section);
        assertTrue(section.contains("geometryFront=account:1001"), section);
        assertFalse(section.contains("frontLine="), "全后排型阵容不得产出 frontLine 名单");
        assertFalse(section.contains("backLine="), "全后排型阵容不得产出 backLine 名单");
    }

    @Test
    void noBacklineWhenAllFrontlineType() {
        // 本队全 HEAVY（E 100）：无后排型车辆 → 不产 backLine 名单，输出 noBacklineVehicle
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),
                player(1002L, 1, "AllyB", 9489L),
                player(2001L, 2, "EnemyA", 9297L),
                player(2002L, 2, "EnemyB", 9297L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("noBacklineVehicle=本阶段阵容无后排型车辆"), section);
        assertTrue(section.contains("frontLine=account:1001"), section);
        assertFalse(section.contains("backLine="), "全前线型阵容不得产出 backLine 名单");
    }

    @Test
    void noStructureWhenAllMedium() {
        // 本队全 MEDIUM（Progetto 65）：无明确前排也无明确后排 → 两个标记都输出，无名单
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 385L),
                player(1002L, 1, "AllyB", 385L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9297L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("noFrontlineVehicle=本阶段阵容无前线型车辆"), section);
        assertTrue(section.contains("noBacklineVehicle=本阶段阵容无后排型车辆"), section);
        assertFalse(section.contains("frontLine="), "全中性阵容不得产出 frontLine 名单");
    }

    @Test
    void profileCapabilityJudgement() {
        // isFrontlineCapable / isBacklineCapable 纯函数：HEAVY=前线、TD/LT=后排、MEDIUM=中性
        final var heavy = new com.wotb.core.replay.evidence.TankTacticalProfile(
                "HEAVY", java.util.List.of("armored_frontline"), java.util.List.of(), java.util.List.of(),
                "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "HIGH", false);
        final var td = new com.wotb.core.replay.evidence.TankTacticalProfile(
                "TANK_DESTROYER", java.util.List.of("long_range_support"), java.util.List.of(), java.util.List.of(),
                "MEDIUM", "HIGH", "HIGH", "MEDIUM", "MEDIUM", false);
        final var light = new com.wotb.core.replay.evidence.TankTacticalProfile(
                "LIGHT", java.util.List.of("scout"), java.util.List.of(), java.util.List.of(),
                "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW", false);
        final var medium = new com.wotb.core.replay.evidence.TankTacticalProfile(
                "MEDIUM", java.util.List.of(), java.util.List.of(), java.util.List.of(),
                "HIGH", "MEDIUM", "HIGH", "MEDIUM", "MEDIUM", false);
        assertTrue(FormationDepthEvidence.isFrontlineCapable(heavy));
        assertFalse(FormationDepthEvidence.isFrontlineCapable(td));
        assertFalse(FormationDepthEvidence.isFrontlineCapable(light));
        assertFalse(FormationDepthEvidence.isFrontlineCapable(medium));
        assertFalse(FormationDepthEvidence.isBacklineCapable(heavy));
        assertTrue(FormationDepthEvidence.isBacklineCapable(td));
        assertTrue(FormationDepthEvidence.isBacklineCapable(light));
        assertFalse(FormationDepthEvidence.isBacklineCapable(medium));
        assertFalse(FormationDepthEvidence.isFrontlineCapable(null));
        assertFalse(FormationDepthEvidence.isBacklineCapable(null));
    }


    @Test
    void regionCoverageEmitsPresenceCountsNotControlTags() {
        // 本队 HEAVY+TD 在左侧区域有位置样本，敌方在右侧 → ownPositionPresence > 0
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ownPositionPresence="), "必须输出本方位置存在数");
        assertTrue(section.contains("enemyPositionPresence="), "必须输出敌方位置存在数");
        assertFalse(section.contains("(presence)"), "不得输出 (presence) 控制权标签");
        assertFalse(section.contains("(firepower)"), "不得输出 (firepower) 控制权标签");
    }

    @Test
    void regionCoverageStillEmittedWhenAllBacklineType() {
        // 本队全 TD：无重甲车辆 → 覆盖测量照常输出（火力权重即能力近似）
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9297L),
                player(1002L, 1, "AllyB", 9297L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), "无重甲阵容仍输出区域覆盖测量");
        assertFalse(section.contains("noArmorNote"), "不得输出控制权依赖注释");
    }

    @Test
    void controlRegionsContestedWhenSymmetric() {
        // 双方同区对称（本队 2 HEAVY vs 敌方 2 HEAVY，位置对称）→ 火力接近 → contested
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 双方都在同一区域附近（x=-100 与 x=-90 交错），本队 1001/1002 与敌方 2001/2002 对称
        events.add(pos(10, 40f, 10, -100f, 0f));
        events.add(pos(12, 40f, 11, -95f, 0f));
        events.add(pos(20, 40f, 20, -105f, 5f));
        events.add(pos(21, 40f, 21, -90f, 5f));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),
                player(1002L, 1, "AllyB", 9489L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ratio="), "对称火力应输出 ratio 测量，got: " + section);
        assertFalse(section.contains("contested"), "不得输出 contested 权威标签，got: " + section);
    }


    @Test
    void badgerOverlapCountsBothCapabilitiesWithoutNegativeNeutral() {
        // FV217 Badger（TANK_DESTROYER + armorReliability=HIGH，tankId 17745）：frontlineCapable=true 且 backlineCapable=true
        // → 两车（HEAVY + Badger）frontlineCapable=2、backlineCapable=1，neutralOnly 逐车计数恒非负
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),     // HEAVY
                player(1002L, 1, "AllyB", 17745L),    // FV217 Badger（TD+armor=HIGH，双 capability）
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("lineupStructure=totalVehicles=2/frontlineCapable=2/backlineCapable=1/neutralOnly=0"),
                "Badger 双 capability 计数正确且 neutralOnly 不为负, got: " + section);
    }

    @Test
    void neutralOnlyCountsVehiclesWithoutEitherCapability() {
        // 全 MEDIUM：frontlineCapable=0、backlineCapable=0、neutralOnly=total（逐车 !front && !back，非减法推导）
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 385L),      // Progetto 65 (MEDIUM)
                player(1002L, 1, "AllyB", 385L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9297L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("lineupStructure=totalVehicles=2/frontlineCapable=0/backlineCapable=0/neutralOnly=2"),
                "neutralOnly 逐车计数, got: " + section);
    }

    @Test
    void postDeathPositionsExcludedFromFormation() {
        // 1001(HEAVY) deathSec=50，但存在 70s/80s type10 position（服务器流残留）
        // → mid/late 阶段 frontLine/midLine/backLine 不得出现该车
        final Battle battle = battle();
        battle.durationS = 100d;
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1001L) {
                pl.survived = false;
                pl.deathTimeMillis = 50_000L; // deathSec = 50
            }
        }
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10（存活）
        events.add(pos(11, 42f, 10, -90f, 0f));    // 1001 t=22（存活）
        events.add(pos(12, 90f, 10, -110f, 0f));   // 1001 t=70（阵亡后残留，应过滤）
        events.add(pos(13, 100f, 10, -115f, 0f));  // 1001 t=80（阵亡后残留，应过滤）
        events.add(pos(14, 40f, 11, -200f, 0f));   // 1002 t=20
        events.add(pos(15, 60f, 11, -190f, 0f));   // 1002 t=40
        events.add(pos(20, 40f, 20, 200f, 0f));    // 2001
        events.add(pos(21, 60f, 20, 210f, 0f));
        events.add(pos(22, 40f, 21, 230f, 50f));   // 2002
        events.add(pos(23, 60f, 21, 235f, 50f));
        // 交火 t=30 → opening [0,45] / mid [45,85] / late [85,100]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(50f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("phase=mid"), section);
        // opening（1001 存活期）可出现；mid+late（死亡后）不得出现
        final String midLate = section.substring(section.indexOf("phase=mid"));
        assertFalse(midLate.contains("account:1001"), "阵亡后位置残留不得进入 mid/late 阵型名单, got: " + midLate);
    }

    @Test
    void postDeathPositionsExcludedFromControlFireCoverage() {
        // 1001 阵亡后（deathSec=10）只有 post-death 位置 → 不进入 tracks → 不贡献 fireCoverage/controlRegions
        final Battle battle = battle();
        battle.durationS = 100d;
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1001L) {
                pl.survived = false;
                pl.deathTimeMillis = 10_000L; // deathSec = 10
            }
        }
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -100f, 0f));   // 1001 t=20（阵亡后，应过滤）
        events.add(pos(11, 40f, 11, -200f, 0f));   // 1002 t=20
        events.add(pos(20, 40f, 20, 200f, 0f));    // 2001
        events.add(pos(21, 40f, 21, 230f, 50f));   // 2002
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertFalse(section.contains("account:1001"), "阵亡车辆不得进入阵型/覆盖测量, got: " + section);
        // 本队存活 1002 有位置、敌方 2001/2002 有位置 → 参考完整，REGION_COVERAGE_MEASUREMENTS 正常输出
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
    }

}