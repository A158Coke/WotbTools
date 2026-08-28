package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Anti-future-leak invariant（docs/architecture/battle-timeline.md §10/§52.2）：
 * 敌方 HP 1500 于 t=100 观测 → 失联 → t=140 重亮 HP=600。
 * contextAt(120) 绝不能出现 600；contextAt(145) 才可出现重亮与 bounded retrospective delta。
 */
class BattleTimelineAntiFutureLeakTest {

    private static final int ENEMY = TimelineTestFixtures.ENEMY_EID;

    @Test
    void contextBeforeReacquireMustNotSeeFutureHp() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 敌方位置流持续到 100s（此后失联）
        events.add(TimelineTestFixtures.position(ENEMY, 100, -12f, -12f, 0f));
        // HP：100s 观测 1500；140s 重亮 600
        events.add(TimelineTestFixtures.health(ENEMY, 100, 1500, true));
        events.add(TimelineTestFixtures.position(ENEMY, 140, -15f, -15f, 0f));
        events.add(TimelineTestFixtures.health(ENEMY, 140, 600, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        // contextAt(120)：位置失联 → LAST_KNOWN；血量只能知道 1500（last-known HP），绝不能 600
        final FrameVehicle at120 = frameVehicle(timeline, 120);
        assertEquals(VehicleKnowledgeState.LAST_KNOWN, at120.knowledgeState());
        assertEquals(1500, at120.health().currentHp());
        assertEquals(100.0, at120.health().currentHpObservedAtSec(), 1e-9);
        assertEquals(20.0, at120.health().currentHpAgeSec(), 1e-9);

        // contextAt(130)：仍未重亮，HP 仍是 1500
        assertEquals(1500, frameVehicle(timeline, 130).health().currentHp());

        // contextAt(145)：已重亮 → 600
        final FrameVehicle at145 = frameVehicle(timeline, 145);
        assertEquals(600, at145.health().currentHp());
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE, at145.knowledgeState());
    }

    @Test
    void reacquireProducesBoundedRetrospectiveHpGapDelta() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(ENEMY, 100, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.health(ENEMY, 100, 1500, true));
        events.add(TimelineTestFixtures.position(ENEMY, 140, -15f, -15f, 0f));
        events.add(TimelineTestFixtures.health(ENEMY, 140, 600, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        // 140s 帧的 delta 必须包含 HP_GAP_DELTA：previousKnownHp=1500 / newKnownHp=600 / gap=40s / exactCauseUnknown=true
        final BattleFrame frame140 = timeline.frameAt(140);
        final BattleDelta gap = frame140.deltas().stream()
                .filter(d -> d.kind() == DeltaKind.HP_GAP_DELTA)
                .findFirst().orElse(null);
        assertNotNull(gap, "expected HP_GAP_DELTA at frame 140");
        assertEquals(1500, gap.number("previousKnownHp", -1), 1e-9);
        assertEquals(600, gap.number("newKnownHp", -1), 1e-9);
        assertEquals(-900, gap.number("hpDelta", 0), 1e-9);
        assertEquals(40.0, gap.number("informationGapSec", -1), 1e-9);
        assertEquals("true", gap.attr("exactCauseUnknown", "false"));

        // 120s 帧绝不能有 HP_GAP_DELTA（信息尚未出现）
        assertTrue(timeline.frameAt(120).deltas().stream()
                .noneMatch(d -> d.kind() == DeltaKind.HP_GAP_DELTA));
    }

    @Test
    void futureDestroyedStateDoesNotLeakIntoPastFrames() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 敌方 150s 才阵亡（alive=false EXACT）
        events.add(TimelineTestFixtures.health(ENEMY, 150, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        // 120s：绝不能预知阵亡
        final FrameVehicle at120 = frameVehicle(timeline, 120);
        assertNull(at120.destroyedKnownAtSec());
        assertTrue(at120.knowledgeState() != VehicleKnowledgeState.DESTROYED_KNOWN);
        // 160s：已确知阵亡
        assertNotNull(frameVehicle(timeline, 160).destroyedKnownAtSec());
        assertEquals(150.0, frameVehicle(timeline, 160).destroyedKnownAtSec(), 1e-9);
    }

    private static FrameVehicle frameVehicle(final BattleTimeline timeline, final int second) {
        return timeline.frameAt(second).vehicles().stream()
                .filter(v -> v.entityId() == ENEMY)
                .findFirst().orElse(null);
    }
}
