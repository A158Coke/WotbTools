package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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
    void friendlyPositionCarriesForwardBeyondStalenessGap() {
        // R7：存活己方 actual combatant 静止 >5s（无新 PositionChanged、无 EntityLeave、未阵亡）
        // → 位置 state 保持 CURRENT / POSITION_STREAM_ACTIVE，不因 age > POSITION_GAP_SEC 降级 LAST_KNOWN。
        // 2026-08-19 真实样本（Maus holland）：存活己方 7/7 成员开局静止 10.8s 同坐标无新位置。
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 己方 FRIENDLY_EID 位置仅 t=0（同坐标不重复广播）；录像者/敌方保持原样
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final FrameVehicle at20 = vehicleAt(timeline, TimelineTestFixtures.FRIENDLY_EID, 20);
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE, at20.knowledgeState());
        assertEquals(PositionKnowledge.CURRENT, at20.position().knowledge());
        assertNotNull(at20.position().position());
        assertEquals(20.0, at20.position().positionAgeSec(), 1e-9);
        assertEquals(PositionSource.CARRIED_FORWARD, at20.position().source());
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
    void enemyKnowledgePartitionIsExclusiveAndDestroyedCountedOnce() {
        // 回归：knowledge partition 必须互斥（known+lastKnown+unknown+destroyedKnown == total），
        // 且一辆敌车阵亡只减少一个 enemyAlive（DESTROYED_KNOWN 不得双重计数）。
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // eid=3 保持位置流活跃（known）；eid=4 于 20s 阵亡（destroyed-known）
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 55, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY2_EID, 55, -25f, -25f, 0f));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY2_EID, 20, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final WorldSummary before = timeline.frameAt(10).world();
        assertEquals(2, before.enemyAlive(), "阵亡前敌方 2 车存活");
        assertEquals(2, before.enemyKnown() + before.enemyLastKnown()
                + before.enemyUnknown() + before.enemyDestroyedKnown(),
                "knowledge partition 必须等于 enemyTotal");

        final WorldSummary after = timeline.frameAt(30).world();
        assertEquals(1, after.enemyAlive(), "一辆敌车阵亡只减少一个 enemyAlive");
        assertEquals(1, after.enemyDestroyedKnown(), "destroyed 只计一次");
        assertEquals(2, after.enemyKnown() + after.enemyLastKnown()
                + after.enemyUnknown() + after.enemyDestroyedKnown(),
                "knowledge partition 必须等于 enemyTotal（互斥、无重复）");
        // 阵亡车仍是 known（DESTROYED_KNOWN 属于已知），未知数不虚增
        assertEquals(0, after.enemyUnknown());
    }

    @Test
    void nullTimestampEventsAreExcludedNotBucketedIntoFrameZero() {
        // timestamp == null 的事件不得被塞进 frame 0，且计入 invalid 计数
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(new com.wotb.core.replay.event.DamageEvent(
                999, null, 8, DecodeConfidence.EXACT,
                TimelineTestFixtures.RECORDER_EID, TimelineTestFixtures.ENEMY_EID,
                null, null, 420, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelineTestFixtures.personalPerspective());
        assertTrue(result.usable());
        final BattleTimeline timeline = result.timeline();
        // null-timestamp 事件被排除在 timeline.events 之外（non-finite 过滤）
        assertTrue(timeline.events().stream().noneMatch(e -> e.sequence() == 999),
                "null timestamp 事件不得进入 timeline");
        // frame 0 的 events 里也不得有它
        assertTrue(timeline.frameAt(0).events().stream().noneMatch(e -> e.sequence() == 999),
                "null timestamp 事件不得被塞进 frame 0");
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

    @Test
    void canonicalTimelineExcludesNonCombatantPositionEntity() {
        // PR #103 最终 ：spectator/camera/静态实体（无任何 participant identity）即使拥有
        // 连续 PositionChanged + >5s gap + region teleport + 阵亡事件，也不得进入 tactical
        // FrameVehicle universe（Canonical BattleTimeline 的 ActualCombatantEntitySet 源头过滤）。
        // 否则 BattleDeltaEngine 会把 team=null 的 spectator 当作 enemy（isEnemy = !friendly()），
        // 产出假的 FIRST_KNOWN / ENEMY_LOST / ENEMY_REACQUIRED / POSITION_CHANGE / REGION_CHANGE / DESTROYED。
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // non-combatant entity 99：无 ParticipantMappingEvent（无身份），连续位置流 + 大 gap + 瞬移 + 阵亡
        events.add(TimelineTestFixtures.created(99, 0));
        events.add(TimelineTestFixtures.position(99, 5, 100f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 10, 105f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 25, 500f, 500f, 0f)); // >5s gap + region teleport
        events.add(TimelineTestFixtures.position(99, 30, 505f, 500f, 0f));
        events.add(TimelineTestFixtures.position(99, 50, 600f, 600f, 0f));
        events.add(TimelineTestFixtures.health(99, 35, 0, false)); // spectator 阵亡信号
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        // 任何帧的 tactical FrameVehicle universe 不得包含 entity 99
        for (final BattleFrame frame : timeline.frames()) {
            assertTrue(frame.vehicles().stream().noneMatch(v -> v.entityId() == 99),
                    "spectator entity 99 不得进入 tactical FrameVehicle: frame " + frame.second());
        }
        // 不得产生 entity 99 的 tactical delta（FIRST_KNOWN/ENEMY_LOST/ENEMY_REACQUIRED/
        // POSITION_CHANGE/REGION_CHANGE/DESTROYED 等）
        for (final BattleFrame frame : timeline.frames()) {
            assertTrue(frame.deltas().stream().noneMatch(d -> d.entityId() != null && d.entityId() == 99),
                    "spectator entity 99 不得产生 tactical delta: frame " + frame.second());
        }
        // WorldSummary 永远保持 2v2 roster（non-combatant 不影响 tactical roster）
        for (final BattleFrame frame : timeline.frames()) {
            assertEquals(2, frame.world().friendlyTotal(), "frame " + frame.second());
            assertEquals(2, frame.world().enemyTotal(), "frame " + frame.second());
            assertEquals(2, frame.world().enemyAlive(),
                    "spectator 阵亡不得减少 enemyAlive: frame " + frame.second());
        }
    }

    @Test
    void nonCombatantWithUsableBroadRosterIdentityStillExcluded() {
        // PR #103 最终 ：即使 broad roster / ParticipantMapping 给 spectator 提供完整身份
        // （accountId=9999 / team / nickname / tank-like metadata），只要 account 不在 #301
        // （battle.players），仍必须从 tactical timeline 排除——防止未来 spectator metadata
        // 更完整后重新污染（spectator ≠ combatant，#301 是权威边界）。
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // spectator 99：usable broad-roster identity（mapping 到 9999 + participants 提供 team/tank/nickname）
        events.add(TimelineTestFixtures.mapping(99, 9999L));
        events.add(TimelineTestFixtures.created(99, 0));
        events.add(TimelineTestFixtures.position(99, 5, 100f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 10, 105f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 25, 500f, 500f, 0f)); // >5s gap + region teleport
        events.add(TimelineTestFixtures.position(99, 50, 600f, 600f, 0f));
        events.add(TimelineTestFixtures.health(99, 35, 0, false));
        final ReplayReconstruction recon = reconWithParticipants(60.0, events,
                List.of(new BattleParticipant(9999L, "SpectatorCam", 2, 9489, "E 100", false)));
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline, "broad-roster spectator 必须被 #301 过滤，timeline 仍可用");

        for (final BattleFrame frame : timeline.frames()) {
            assertTrue(frame.vehicles().stream().noneMatch(v -> v.entityId() == 99),
                    "usable broad-roster 身份的 spectator 仍不得进入 FrameVehicle: frame " + frame.second());
            assertTrue(frame.deltas().stream().noneMatch(d -> d.entityId() != null && d.entityId() == 99),
                    "usable broad-roster 身份的 spectator 不得产生 tactical delta: frame " + frame.second());
            assertEquals(2, frame.world().friendlyTotal(), "frame " + frame.second());
            assertEquals(2, frame.world().enemyTotal(),
                    "broad-roster spectator(team=2) 不得把 enemyTotal 从 2 撑到 3: frame " + frame.second());
        }
    }

    private static ReplayReconstruction reconWithParticipants(
            final double durationSec,
            final List<ReplayEvent> events,
            final List<BattleParticipant> participants) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", durationSec, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(
                true, 1, 1, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(),
                true, TimelineTestFixtures.START_RAW, true);
        final BattleStateSnapshot finalState = BattleStateSnapshot.empty();
        return new ReplayReconstruction(
                meta, header, (float) durationSec, TimelineTestFixtures.START_RAW,
                participants, List.copyOf(events), List.of(), finalState, coverage, diag);
    }

    private static FrameVehicle vehicleAt(final BattleTimeline timeline, final int eid, final int second) {
        return timeline.frameAt(second).vehicles().stream()
                .filter(v -> v.entityId() == eid)
                .findFirst().orElse(null);
    }
}
