package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Canonical Timeline 构建核心测试：帧边界 / 知识状态 / 血量 / 阵亡 / world 统计。
 */
class BattleTimelineBuilderTest {

    @Test
    void buildsDeterministicFramesWithBattleRelativeBoundaries() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 1.5, 420));
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 2.5, 100));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);

        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        assertNotNull(timeline);
        assertTrue(timeline.validation().valid());
        // 60s 战斗 → second 0..60 = 61 帧
        assertEquals(61, timeline.frames().size());
        assertEquals(0, timeline.frames().get(0).second());
        assertEquals(60, timeline.frames().get(timeline.frames().size() - 1).second());

        // 帧 2 的事件 = (1, 2]：只有 1.5s 的 damage（420）
        final BattleFrame frame2 = timeline.frameAt(2);
        assertEquals(1, frame2.events().size());
        assertEquals(420, ((com.wotb.core.replay.event.DamageEvent) frame2.events().get(0)).damage());
        // 帧 3 的事件 = (2, 3]：2.5s damage
        assertEquals(1, timeline.frameAt(3).events().stream()
                .filter(e -> !(e instanceof PositionChangedEvent)).count());

        // 确定性：两次构建结果一致
        final BattleTimeline again = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertEquals(timeline.frames().size(), again.frames().size());
        assertEquals(timeline.frames().get(30).world(), again.frames().get(30).world());
    }

    @Test
    void enemyKnowledgeTransitionsFromActiveToLastKnown() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 敌方 eid=3 位置流只到 10s
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 10, -12f, -12f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        // t=10（age=0）→ POSITION_STREAM_ACTIVE
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 10).knowledgeState());
        // t=15（age=5，≤ GAP=5）→ 仍 ACTIVE
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 15).knowledgeState());
        // t=16（age=6 > 5）→ LAST_KNOWN，位置沿用最后已知（不消失、不插值）
        final FrameVehicle at16 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 16);
        assertEquals(VehicleKnowledgeState.LAST_KNOWN, at16.knowledgeState());
        assertEquals(PositionKnowledge.LAST_KNOWN, at16.position().knowledge());
        assertNotNull(at16.position().position());
        assertEquals(6.0, at16.position().positionAgeSec(), 1e-9);
        assertEquals(PositionSource.CARRIED_FORWARD, at16.position().source());
    }

    @Test
    void destroyedKnownIsWorldFactAtTimeAndOverridesPositionKnowledge() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 30, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        // t=25：尚未阵亡（world fact 是 30s 才发生）
        final FrameVehicle at25 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 25);
        assertFalse(at25.lifeState() == LifeState.DESTROYED);
        assertNull(at25.destroyedKnownAtSec());
        // t=35：已确知阵亡
        final FrameVehicle at35 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 35);
        assertEquals(LifeState.DESTROYED, at35.lifeState());
        assertEquals(VehicleKnowledgeState.DESTROYED_KNOWN, at35.knowledgeState());
        assertEquals(30.0, at35.destroyedKnownAtSec(), 1e-9);
    }

    @Test
    void worldSummaryCountsEnemyKnowledgeAndUnknown() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 敌方 eid=3 位置流中断于 10s；eid=4 持续
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 10, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY2_EID, 50, -25f, -25f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final WorldSummary world = timeline.frameAt(40).world();
        assertEquals(2, world.friendlyTotal());
        assertEquals(2, world.friendlyAlive());
        assertEquals(2, world.enemyTotal());
        // 40s 时 eid=3 最后位置在 10s（age=30>5 → last-known）、eid=4 最后位置在 0s（age=40>5 → last-known）
        assertEquals(0, world.enemyKnown());
        assertEquals(2, world.enemyLastKnown());
        assertEquals(0, world.enemyUnknown());
        // 55s 时 eid=4 已在 50s 重新上报（age=5 → active）
        assertEquals(1, timeline.frameAt(55).world().enemyKnown());
        assertEquals(1, timeline.frameAt(55).world().enemyLastKnown());
        // 无阵亡：enemyAlive = 2
        assertEquals(2, world.enemyAlive());
    }

    @Test
    void clockEstimatedFallbackWhenNoBattleStartIdentified() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.battleEnded(60.0));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        // 清掉 IDENTIFIED start：重建 null start + 事件 battleClock 为 null
        final ReplayReconstruction noStart = new ReplayReconstruction(
                recon.metadata(), recon.streamHeader(), recon.replayDurationSec(), null,
                recon.participants(), recon.events(), recon.checkpoints(),
                recon.finalState(), recon.coverage(), recon.diagnostics());

        final BattleTimelineResult result =
                BattleTimelineBuilder.build(battle, noStart, TimelineTestFixtures.personalPerspective());
        assertTrue(result.usable());
        assertEquals(BattleTimelineClock.ESTIMATED, result.timeline().clockResolution());
        assertTrue(result.timeline().limitations().contains("CLOCK_ESTIMATED"));
    }

    @Test
    void frameEventsKeepPreciseTimestamps() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 10.7, 1200, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        // 10.7s 事件落在 frame 11（(10, 11]），且保留精确 battle-relative 时间
        final BattleFrame frame11 = timeline.frameAt(11);
        final HealthChangedEvent hp = frame11.events().stream()
                .filter(HealthChangedEvent.class::isInstance)
                .map(HealthChangedEvent.class::cast)
                .filter(e -> e.entityId() == TimelineTestFixtures.ENEMY_EID)
                .findFirst().orElse(null);
        assertNotNull(hp);
        assertEquals(10.7, TimelineClock.battleClockOf(hp, timeline.battleStartRawClockSec()), 1e-3);
        // 帧 10（(9,10]）不含该事件
        assertFalse(timeline.frameAt(10).events().stream()
                .anyMatch(e -> e instanceof HealthChangedEvent
                        && ((HealthChangedEvent) e).entityId() == TimelineTestFixtures.ENEMY_EID));
    }

    private static FrameVehicle vehicleAt(final BattleTimeline timeline, final int eid, final int second) {
        return timeline.frameAt(second).vehicles().stream()
                .filter(v -> v.entityId() == eid)
                .findFirst().orElse(null);
    }
}
