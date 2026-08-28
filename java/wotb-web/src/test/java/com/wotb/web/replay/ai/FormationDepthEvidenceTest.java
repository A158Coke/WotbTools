package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.PositionKnowledge;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** FormationDepthEvidence：阵型深度（前后排）与控制区域确定性证据段渲染。 */
class FormationDepthEvidenceTest {

    private static final String MAP = "holland";

    /** 真实 tankopedia id（tier10）：9489=E 100(HEAVY)、9297=FV215b 183(TD)、385=Progetto 65(MEDIUM)、19537=Vickers Light(LT)。 */
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

    /** 双方 4 车，各自集中在不同区域；本队 1001 更靠敌方、1002 靠后。 */
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
        // 敌方 phase 末（t=100，opening=[0,100]）保持 CURRENT：敌方位置观测 ≥ 当前阈值内才算 current，
        // 不能只开局有位置（真实连续位置流；enemy stale → LAST_KNOWN → fail-close exact coverage）
        events.add(pos(24, 120f, 20, 210f, 0f));  // 2001 t=100
        events.add(pos(25, 120f, 21, 235f, 50f)); // 2002 t=100
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
    void rendersGeometricTercilesAndCoverageMeasurements() {
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("=== FORMATION_DEPTH"), section);
        assertTrue(section.contains("phase=opening"), section);
        // 1001 更靠敌方 → 最靠前三分位；1002 靠后 → 最靠后三分位（纯几何，不依赖 tank profile）
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001"), section);
        assertTrue(section.contains("GEOMETRIC_REAR=account:1002"), section);
        // GEOMETRIC_* 名单带 tank profile 静态事实标注（HEAVY/TD），但不得出现 tactical-role 标签
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001(HEAVY"), section);
        assertFalse(section.contains("frontlineCapable"), "不得输出 frontlineCapable 标签: " + section);
        assertFalse(section.contains("backlineCapable"), "不得输出 backlineCapable 标签");
        assertFalse(section.contains("lineupStructure"), "不得输出 lineupStructure 战术角色结构行");
        assertFalse(section.contains("noFrontlineVehicle"), "不得输出 noFrontlineVehicle");
        assertFalse(section.contains("noBacklineVehicle"), "不得输出 noBacklineVehicle");
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

    /** 提取 phase=mid 的段文本（到 phase=late 为止），供分阶段断言。 */
    private static String midBlock(final String section) {
        final int mid = section.indexOf("phase=mid");
        final int late = section.indexOf("phase=late");
        return late > mid ? section.substring(mid, late) : section.substring(mid);
    }

    @Test
    void friendlyStationaryCarryForwardRemainsCurrent() {
        // A：己方 actual combatant 在 phase 前有最后位置、phase 内无新 PositionChanged、无 EntityLeave、未阵亡
        // → friendly carry-forward 保持 CURRENT（canonical knowledge 契约），仍参与 current formation reference。
        // 敌方在 mid 内保持新鲜（CURRENT）→ exact coverage/几何正常输出，不得 POSITION_COVERAGE_INSUFFICIENT。
        // 2026-08-19 真实样本（Maus holland）：存活己方开局静止 10.8s 同坐标无新位置。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 己方所有位置只在 opening（t=10）：mid [15.5,25] 内无新样本 → carry-forward（friendly=CURRENT）
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        // 敌方 opening t=8 + mid 内 t=24（≤25 且 age=1 ≤ 当前阈值）→ mid 内 CURRENT
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        events.add(pos(14, 44f, 20, 200f, 0f));    // 2001 t=24
        events.add(pos(15, 44f, 21, 230f, 50f));   // 2002 t=24
        // 交火 t=0.5 → opening [0,15.5] / mid [15.5,25] / late [25,40]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        assertFalse(mid.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "friendly carry-forward（CURRENT）不得判位置覆盖不足: " + mid);
        assertTrue(mid.contains("REGION_COVERAGE_MEASUREMENTS"), mid);
        // 己方 1001（靠敌）仍出现在 mid 的几何纵深（carry-forward 位置参与 current 阵型）
        assertTrue(mid.contains("GEOMETRIC_FORWARD=account:1001"), mid);
        assertTrue(mid.contains("GEOMETRIC_REAR=account:1002"), mid);
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), mid);
    }

    @Test
    void enemyStalePositionRemainsLastKnown() {
        // B：enemy 最后位置 t=8（mid 前），phaseEnd=25（>15），mid 内无新位置
        // → enemy carry-forward 必须保持 LAST_KNOWN：不得满足 current completeness、不得形成 exact
        //   current coverage/distance、不得 future-leak；只输出 INSUFFICIENT + ENEMY_LAST_KNOWN_POSITION_REFERENCES。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 双方所有位置都只在 opening：mid [15.5,25] 内无任何新样本
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        // P0-1：enemy 在 t=20 离开（Type4）→ observed segment [8,20) 关闭 → mid 末（25）位于
        // UNKNOWN_AOI gap → enemy carry-forward 必须 LAST_KNOWN（fail-closed，不进 exact geometry）。
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(40, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(41, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        // 交火 t=0.5 → opening [0,15.5] / mid [15.5,25] / late [25,40]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        // friendly carry-forward 仍 CURRENT（ownRef=2/2），enemy 位于 UNKNOWN_AOI gap → LAST_KNOWN（enemyRef=0/2）
        assertTrue(mid.contains("POSITION_COVERAGE_INSUFFICIENT：ownRef=2/2 enemyRef=0/2"), mid);
        // LAST_KNOWN 只作为独立信息：account + region + observedAtSec + ageSec + knowledge=LAST_KNOWN
        assertTrue(mid.contains("ENEMY_LAST_KNOWN_POSITION_REFERENCES"), mid);
        assertTrue(mid.contains("account:2001"), mid);
        assertTrue(mid.contains("observedAtSec=8.0"), mid);
        assertTrue(mid.contains("ageSec=17.0"), mid);
        assertTrue(mid.contains("knowledge=LAST_KNOWN"), mid);
        // 不得把 stale enemy 当 current：无 exact 分数、无几何纵深（enemy CURRENT centroid 缺失）
        assertFalse(mid.contains("ownWeightedCoverageScore="), "stale enemy 不得产生 exact coverage 分数: " + mid);
        assertFalse(mid.contains("GEOMETRIC_FORWARD="), "stale enemy 不得作为 current enemy centroid: " + mid);
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
        assertFalse(section.contains("GEOMETRIC_FORWARD="), "敌方无位置观测时不得输出几何纵深");
    }


    @Test
    void geometricTercilesAlwaysEmittedRegardlessOfProfile() {
        // 本队全 TD（FV215b 183）：纯几何三分位照常输出（1001 靠前 → GEOMETRIC_FORWARD、1002 靠后 → GEOMETRIC_REAR），
        // 不产出任何 tactical-role 标签（frontlineCapable/noFrontlineVehicle 等）
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9297L),
                player(1002L, 1, "AllyB", 9297L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001"), section);
        assertTrue(section.contains("GEOMETRIC_REAR=account:1002"), section);
        assertFalse(section.contains("frontlineCapable"), "全 TD 阵容不得输出 frontlineCapable: " + section);
        assertFalse(section.contains("noFrontlineVehicle"), "不得输出 noFrontlineVehicle");
        assertFalse(section.contains("backlineCapable"), "不得输出 backlineCapable");
        assertFalse(section.contains("noBacklineVehicle"), "不得输出 noBacklineVehicle");
    }

    @Test
    void geometricTercilesStillEmittedForAllHeavyAndAllMediumLineups() {
        // 全 HEAVY 与全 MEDIUM 阵容：三分位恒输出，同样无 tactical-role 标签
        final Battle heavyBattle = battle();
        heavyBattle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),
                player(1002L, 1, "AllyB", 9489L),
                player(2001L, 2, "EnemyA", 9297L),
                player(2002L, 2, "EnemyB", 9297L));
        final String heavySection = FormationDepthEvidence.renderSection(heavyBattle, reconWithPositions(20f), 1, MAP);
        assertTrue(heavySection.contains("GEOMETRIC_FORWARD=account:1001"), heavySection);
        assertTrue(heavySection.contains("GEOMETRIC_REAR=account:1002"), heavySection);
        assertFalse(heavySection.contains("backlineCapable"), heavySection);
        assertFalse(heavySection.contains("noBacklineVehicle"), heavySection);

        final Battle mediumBattle = battle();
        mediumBattle.players = List.of(
                player(1001L, 1, "AllyA", 385L),
                player(1002L, 1, "AllyB", 385L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9297L));
        final String mediumSection = FormationDepthEvidence.renderSection(mediumBattle, reconWithPositions(20f), 1, MAP);
        assertTrue(mediumSection.contains("GEOMETRIC_FORWARD=account:1001"), mediumSection);
        assertTrue(mediumSection.contains("GEOMETRIC_REAR=account:1002"), mediumSection);
        assertFalse(mediumSection.contains("frontlineCapable"), mediumSection);
        assertFalse(mediumSection.contains("noFrontlineVehicle"), mediumSection);
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
        // 无交火 → opening=[0,100]；敌方 phase 末保持 CURRENT（对称火力对比才成立）
        events.add(pos(22, 120f, 20, -105f, 5f));  // 2001 t=100
        events.add(pos(23, 120f, 21, -90f, 5f));   // 2002 t=100
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
    void noTacticalRoleLabelsInAnyLineupComposition() {
        // 双 capability（FV217 Badger：TANK_DESTROYER + armorReliability=HIGH）阵容：
        // 纯几何三分位照常输出；任何 capability/role 计数与 noFrontline/noBackline 标签都不得出现
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),     // HEAVY
                player(1002L, 1, "AllyB", 17745L),    // FV217 Badger（TD+armor=HIGH）
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("GEOMETRIC_FORWARD="), section);
        assertTrue(section.contains("GEOMETRIC_REAR="), section);
        assertFalse(section.contains("lineupStructure"), "不得输出 lineupStructure: " + section);
        assertFalse(section.contains("frontlineCapable"), section);
        assertFalse(section.contains("backlineCapable"), section);
        assertFalse(section.contains("noFrontlineVehicle"), section);
        assertFalse(section.contains("noBacklineVehicle"), section);
        assertFalse(section.contains("neutralOnly"), section);
    }

    @Test
    void postDeathPositionsExcludedFromFormation() {
        // 1001(HEAVY) deathSec=50，但存在 70s/80s type10 position（服务器流残留）
        // → mid/late 阶段 GEOMETRIC_* 三分位名单不得出现该车
        final Battle battle = battle();
        battle.durationS = 100d;
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1001L) {
                pl.survived = false;
                pl.deathTimeMillis = 50_000L; // deathSec = 50
                pl.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
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
                pl.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
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

    @Test
    void carriedFriendlyCountsInRegionPresence() {
        // carry-forward 的己方车辆（phase 内无新位置）仍计 1 到其区域的 ownPositionPresence
        // （presence 基于 resolved 车辆位置 state，不是位置包数量）。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 己方位置只在 t=10（mid 内 carry-forward）；敌方 mid 内新鲜（t=24）→ mid CURRENT 完整
        // 1001 在 (-100,0)（region 4）、1002 在 (100,-200)（region 9）：两辆分属不同区域
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, 100f, -200f)); // 1002 t=10
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        events.add(pos(14, 44f, 20, 200f, 0f));    // 2001 t=24
        events.add(pos(15, 44f, 21, 230f, 50f));   // 2002 t=24
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        final String mid = midBlock(section);
        assertTrue(mid.contains("REGION_COVERAGE_MEASUREMENTS"), mid);
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), mid);
        // 己方 2 辆（含 carry-forward）→ 每区 presence 按车辆计 1（不是各自 2 个包），合计 2
        int ownPresenceTotal = 0;
        for (final String line : mid.split("\n")) {
            if (!line.contains("ownPositionPresence=")) {
                continue;
            }
            final int idx = line.indexOf("ownPositionPresence=") + "ownPositionPresence=".length();
            final int space = line.indexOf(' ', idx);
            final int value = Integer.parseInt(line.substring(idx, space > 0 ? space : line.length()));
            assertTrue(value <= 1, "presence 每区最多按 1 辆计，got " + value + ": " + line);
            ownPresenceTotal += value;
        }
        assertTrue(ownPresenceTotal == 2, "己方 2 辆（含 carry-forward）presence 合计 2，got: " + ownPresenceTotal);
    }

    @Test
    void regionPresenceCountsVehiclesNotPositionPackets() {
        // 同一车辆 phase 内 100 个 PositionChanged → presence 仍是 1（不是 100）。
        final Battle battle = battle();
        battle.durationS = 60d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 本队 1001 在同一区域高频发包（100 次）→ presence 仍 1；1002 在另一区域静止单点；敌方保持新鲜
        int seq = 10;
        for (int i = 0; i < 100; i++) {
            events.add(pos(seq++, 40f + i * 0.1f, 10, -100f, 0f));
        }
        events.add(pos(seq++, 40f, 11, 100f, -200f)); // 1002（region 9，与 1001 的 region 4 不同）
        events.add(pos(seq++, 40f, 20, 200f, 0f));
        events.add(pos(seq++, 40f, 21, 230f, 50f));
        events.add(pos(seq++, 80f, 20, 200f, 0f));   // 2001 t=60（phase 末新鲜）
        events.add(pos(seq++, 80f, 21, 230f, 50f));  // 2002 t=60
        events.add(new com.wotb.core.replay.event.DamageEvent(seq, new ReplayTimestamp(30f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        // 交火 t=10 → opening [0,25] / mid [25,45] / late [45,60]；1001 的 100 个包都在 opening
        assertTrue(section.contains("ownPositionPresence="), section);
        for (final String line : section.split("\n")) {
            if (!line.contains("coverageCompleteness=ownRef=2/2") || !line.contains("ownPositionPresence=")) {
                continue;
            }
            final int idx = line.indexOf("ownPositionPresence=") + "ownPositionPresence=".length();
            final int space = line.indexOf(' ', idx);
            final int value = Integer.parseInt(line.substring(idx, space > 0 ? space : line.length()));
            assertTrue(value <= 1,
                    "presence 必须按车辆计 1（100 个包仍是 1 辆，不得膨胀到 100），got: " + line);
        }
    }

    @Test
    void spectatorDoesNotAffectCoverage() {
        // 非 #301（spectator/observer/camera/静态实体）位置不得影响战术位置覆盖：
        // coverageCompleteness 仍按 #301 actual combatants 计算，输出不得出现 spectator 账号。
        final Battle battle = battle();
        battle.durationS = 100d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // spectator（非 #301）：mapping 到 accountId=9999，整场大量位置
        events.add(new ParticipantMappingEvent(5, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 50, 9999L));
        events.add(pos(20, 40f, 10, -100f, 0f));
        events.add(pos(21, 40f, 11, -200f, 0f));
        events.add(pos(22, 40f, 20, 200f, 0f));
        events.add(pos(23, 40f, 21, 230f, 50f));
        events.add(pos(24, 120f, 20, 210f, 0f));   // 2001 t=100
        events.add(pos(25, 120f, 21, 235f, 50f));  // 2002 t=100
        for (int i = 0; i < 50; i++) {
            events.add(pos(30 + i, 40f + i * 0.5f, 50, 0f, 0f)); // spectator 位置
        }
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"),
                "spectator 不得影响 coverage completeness: " + section);
        assertFalse(section.contains("account:9999"), "spectator 账号不得进入阵型/覆盖测量: " + section);
    }

    @Test
    void partialEnemyCurrentDoesNotProduceGeometricTerciles() {
        // PR #103 最终 review B2：enemy CURRENT 不完整（2 存活、1 CURRENT + 1 LAST_KNOWN）时，
        // 不得用 1 辆敌方 CURRENT 建立 whole-team enemy centroid 输出我方 GEOMETRIC_*
        // （否则与覆盖段 POSITION_COVERAGE_INSUFFICIENT enemyRef=1/2 自相矛盾）；
        // 只输出 fail-closed 段（INSUFFICIENT + CURRENT presence + coverage counts + LAST_KNOWN 独立信息）。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 己方所有位置只在 opening（t=10）：mid [15.5,25] 内无新样本 → friendly carry-forward CURRENT
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        // 敌方 2001 保持新鲜（t=24 → mid CURRENT）；2002 只有 t=8（mid age=17 → LAST_KNOWN）
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        events.add(pos(14, 44f, 20, 200f, 0f));    // 2001 t=24
        // P0-1：2002 在 t=20 离开（Type4）→ segment [8,20) 关闭 → mid 末（25）位于 gap → LAST_KNOWN。
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(31, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        // 交火 t=0.5 → opening [0,15.5] / mid [15.5,25] / late [25,40]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        assertTrue(mid.contains("POSITION_COVERAGE_INSUFFICIENT：ownRef=2/2 enemyRef=1/2"), mid);
        assertTrue(mid.contains("ENEMY_LAST_KNOWN_POSITION_REFERENCES"), mid);
        assertTrue(mid.contains("account:2002"), "LAST_KNOWN 独立信息必须包含 stale enemy 2002: " + mid);
        // partial CURRENT 不得建立 whole-team geometric axis / exact 分数
        assertFalse(mid.contains("GEOMETRIC_FORWARD="), "partial enemy CURRENT 不得输出 GEOMETRIC_FORWARD: " + mid);
        assertFalse(mid.contains("GEOMETRIC_MIDDLE="), "partial enemy CURRENT 不得输出 GEOMETRIC_MIDDLE: " + mid);
        assertFalse(mid.contains("GEOMETRIC_REAR="), "partial enemy CURRENT 不得输出 GEOMETRIC_REAR: " + mid);
        assertFalse(mid.contains("ownWeightedCoverageScore="), "partial enemy CURRENT 不得输出 own 分数: " + mid);
        assertFalse(mid.contains("enemyWeightedCoverageScore="), "partial enemy CURRENT 不得输出 enemy 分数: " + mid);
    }

    @Test
    void enemyInOpenObservedSegmentStaysCurrentBeyondAgeThreshold() {
        // P0-1 回归：enemy 位置在 opening t=8，mid 末（25）远大于 5s（age=17），无 Type4 →
        // observed segment [8,..) 保持打开 → enemy 仍 CURRENT（不得因 age>5s 被踢出 exact geometry）。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        // 无 Type4（leave）→ enemy observed segment 持续打开；carry-forward 的 enemy 在 mid[CURRENT]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        // enemy 位于 open observed segment（age=17 > 5s）→ 仍 CURRENT，完整 → 不 fail-close，输出 exact 分数
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"),
                "open segment 内 age>5s 的 enemy 不得被踢出 exact geometry: " + mid);
        assertTrue(mid.contains("ownWeightedCoverageScore="), mid);
        assertTrue(mid.contains("enemyWeightedCoverageScore="), mid);
        assertFalse(mid.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "open segment 内 enemy age>5s 不得误报 INSUFFICIENT: " + mid);
    }

    @Test
    void phasePositionDoesNotMixCoordinatesAcrossAoiGap() {
        // P0-1（Deep Review）：phase [0,60]，敌方实体在 segment A（t=0, x=0）→ Type4@10 →
        // UNKNOWN_AOI gap → Type5@50 re-entry → segment B（t=55, x=100）。phaseEnd=60 属 segment B。
        // resolvePhasePosition 的 CURRENT 参考必须只来自 segment B（x≈100），不得把 A+B 平均（x≈50）。
        final Battle battle = battle();
        battle.durationS = 60d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(10, 20f, 20, 0f, 0f));                     // t=0   segment A x=0
        events.add(new EntityRemovedEvent(11, new ReplayTimestamp(30f, null), 4,
                DecodeConfidence.EXACT, 20));                    // leave@10
        events.add(new MaterializationEvent(12, new ReplayTimestamp(70f, null), 5,
                DecodeConfidence.EXACT, 20, 2, null, new byte[0], new byte[0])); // re-enter@50
        events.add(pos(13, 75f, 20, 100f, 0f));                   // t=55   segment B x=100
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 20.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> track = List.of(
                new FormationDepthEvidence.PositionSample(20, 0.0, 0.0, 0.0),
                new FormationDepthEvidence.PositionSample(20, 55.0, 100.0, 0.0));

        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, track, 0.0, 60.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.CURRENT, ref.knowledge(),
                "phaseEnd 属 segment B → CURRENT");
        assertEquals(100.0, ref.x(), 1e-6,
                "CURRENT 参考必须只来自 phaseEnd 的 observed segment（segment B），不得与 segment A 平均成 50");
    }

    @Test
    void phasePositionInAoiGapIsNotCurrent() {
        // P0-1：phaseEnd ∈ UNKNOWN_AOI gap（无 observed segment）→ 不产出 CURRENT exact geometry。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(10, 20f, 20, 0f, 0f));                     // t=0   segment A x=0
        events.add(new EntityRemovedEvent(11, new ReplayTimestamp(30f, null), 4,
                DecodeConfidence.EXACT, 20));                    // leave@10
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 20.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> track = List.of(
                new FormationDepthEvidence.PositionSample(20, 0.0, 0.0, 0.0));
        // phaseEnd=30 处于 leave 之后（segment A [0,10) 已关闭）→ UNKNOWN_AOI gap → 非 CURRENT（LAST_KNOWN）
        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, track, 0.0, 30.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.LAST_KNOWN, ref.knowledge(),
                "phaseEnd ∈ UNKNOWN_AOI gap → 不产出 CURRENT（LAST_KNOWN，fail-closed）");
    }

    @Test
    void reentryOverlapUsesOnlySameEntitySamplesForCurrent() {
        // Item P1 回归：account 2001 跨越两个实体生命周期（re-entry 重叠）。
        // 实体 A(20) 观测段 [2,10)（t=2..8 有位置）→ Type4@10 关闭（terminal/destroyed）；
        // 实体 B(25) 于 t=6 重入（Materialization）且延续到 t=14（Type4）→ B 观测段 [6,14)。
        // phaseEnd=10 位于 B(25) 的 observed segment → CURRENT 参考必须只消费 B(25) 的样本（x=100/110 → 105），
        // 不得把 A(20) 的 t=8 x=20 并入（旧的 accountId-flattened track 会把 A 的 x=20 一起平均成 76.67）。
        final Battle battle = battle();
        battle.durationS = 20d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 25, 2001L));
        events.add(pos(10, 23f, 20, 10f, 0f));   // A t=2 x=10
        events.add(pos(11, 29f, 20, 20f, 0f));   // A t=8 x=20
        events.add(new MaterializationEvent(12, new ReplayTimestamp(27f, null), 5,
                DecodeConfidence.EXACT, 25, 1, null, new byte[0], new byte[0])); // B re-enter t=6
        events.add(pos(13, 28f, 25, 100f, 0f));  // B t=7 x=100
        events.add(pos(14, 30f, 25, 110f, 0f));  // B t=9 x=110
        events.add(new EntityRemovedEvent(15, new ReplayTimestamp(31f, null), 4,
                DecodeConfidence.EXACT, 20));    // A terminal t=10
        events.add(new EntityRemovedEvent(16, new ReplayTimestamp(35f, null), 4,
                DecodeConfidence.EXACT, 25));    // B leave t=14
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 21f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 21.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> samples = List.of(
                new FormationDepthEvidence.PositionSample(20, 2.0, 10.0, 0.0),
                new FormationDepthEvidence.PositionSample(20, 8.0, 20.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 7.0, 100.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 9.0, 110.0, 0.0));

        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, samples, 0.0, 10.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.CURRENT, ref.knowledge(),
                "phaseEnd=10 位于 B(25) observed segment → CURRENT");
        assertEquals(105.0, ref.x(), 1e-6,
                "CURRENT 参考只消费 B(25) 样本（(100+110)/2=105），不得并入 A(20) 的 x=20");
    }

    @Test
    void reentryGapAfterEntityCloseIsLastKnown() {
        // Item P1 回归：phaseEnd=16 处于 B(25) 段关闭后的 UNKNOWN_AOI gap（A、B 均 Type4 关闭）
        // → 同实体 carry-forward 退化为 LAST_KNOWN，不得当作 CURRENT（fail-closed）。
        final Battle battle = battle();
        battle.durationS = 20d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 25, 2001L));
        events.add(pos(10, 23f, 20, 10f, 0f));   // A t=2 x=10
        events.add(pos(11, 29f, 20, 20f, 0f));   // A t=8 x=20
        events.add(new MaterializationEvent(12, new ReplayTimestamp(27f, null), 5,
                DecodeConfidence.EXACT, 25, 1, null, new byte[0], new byte[0])); // B re-enter t=6
        events.add(pos(13, 28f, 25, 100f, 0f));  // B t=7 x=100
        events.add(pos(14, 30f, 25, 110f, 0f));  // B t=9 x=110
        events.add(new EntityRemovedEvent(15, new ReplayTimestamp(31f, null), 4,
                DecodeConfidence.EXACT, 20));    // A terminal t=10
        events.add(new EntityRemovedEvent(16, new ReplayTimestamp(35f, null), 4,
                DecodeConfidence.EXACT, 25));    // B leave t=14
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 21f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 21.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> samples = List.of(
                new FormationDepthEvidence.PositionSample(20, 2.0, 10.0, 0.0),
                new FormationDepthEvidence.PositionSample(20, 8.0, 20.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 7.0, 100.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 9.0, 110.0, 0.0));

        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, samples, 0.0, 16.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.LAST_KNOWN, ref.knowledge(),
                "phaseEnd=16 位于 UNKNOWN_AOI gap → LAST_KNOWN（fail-closed，不作 CURRENT）");
        assertEquals(110.0, ref.x(), 1e-6,
                "LAST_KNOWN 取 B(25) 最后一次样本（t=9 x=110），保持单实体来源");
    }

    @Test
    void completeEnemyCurrentStillProducesGeometricTerciles() {
        // PR #103 最终 review B2 保留：双方 CURRENT 完整（ownRef=2/2 enemyRef=2/2）时，
        // GEOMETRIC_* 三分位与距离加权覆盖分照常输出（fail-close gate 不得误伤完整场景）。
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001"), section);
        assertTrue(section.contains("GEOMETRIC_REAR=account:1002"), section);
        assertTrue(section.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), section);
        assertTrue(section.contains("ownWeightedCoverageScore="), section);
        assertTrue(section.contains("enemyWeightedCoverageScore="), section);
        assertFalse(section.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "双方 CURRENT 完整时不得 fail-close: " + section);
    }

    }