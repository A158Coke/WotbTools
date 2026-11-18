package com.wotb.ai.review;

import com.wotb.core.model.Battle;
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

import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.MAP;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.battle;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.midBlock;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.player;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.pos;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.reconWithPositions;

/** FormationDepthEvidence：阵型深度（前后排）与控制区域确定性证据段渲染。 */
class FormationDepthEvidenceTest {

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
                pl.settlementLifeTimeSec = 50;
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
    void partialEnemyCurrentDoesNotProduceGeometricTerciles() {
        // PR #103：enemy CURRENT 不完整（2 存活、1 CURRENT + 1 LAST_KNOWN）时，
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
    void completeEnemyCurrentStillProducesGeometricTerciles() {
        // PR #103：保留：双方 CURRENT 完整（ownRef=2/2 enemyRef=2/2）时，
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
