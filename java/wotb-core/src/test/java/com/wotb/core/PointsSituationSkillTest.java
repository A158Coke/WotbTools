package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.PointsSituationSkill;
import com.wotb.core.replay.evidence.PointsSituationSkill.CapturePresence;
import com.wotb.core.replay.evidence.PointsSituationSkill.KillPointsEvent;
import com.wotb.core.replay.evidence.PointsSituationSkill.PositionSample;
import com.wotb.core.replay.evidence.PointsSituationSkill.PushWindow;
import com.wotb.core.replay.evidence.PointsSituationSkill.VehicleTrack;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PointsSituationSkill 纯函数单测：击杀夺分时间线 / 占领点存在 / 推进窗口。
 * 坐标口径：DEFAULT profile（raw ±250 → canonical 0..500），raw (0,0) → 中心 5 区；
 * 区域判定只依赖 MapRegionResolver 与给定的占领点区域集合，不读语义库。
 */
class PointsSituationSkillTest {

    private static final String MAP = "test-map";

    private static PlayerResult deadPlayer(final int team, final long deathTimeMillis) {
        final PlayerResult player = new PlayerResult();
        player.team = team;
        player.survived = false;
        player.deathTimeMillis = deathTimeMillis;
        return player;
    }

    private static PlayerResult survivor(final int team) {
        final PlayerResult player = new PlayerResult();
        player.team = team;
        player.survived = true;
        return player;
    }

    @Test
    void killPointsTimelineOrdersByDeathTimeAndSkipsUnknownOrInvalid() {
        final Battle battle = new Battle();
        battle.players = List.of(
                survivor(1),
                deadPlayer(1, 60_000L),
                deadPlayer(2, 30_000L),
                survivor(2),
                deadPlayer(3, 15_000L),   // 无效队伍：跳过
                deadPlayer(1, 0L));       // 死亡时刻未知：跳过

        final List<KillPointsEvent> events = PointsSituationSkill.killPointsTimeline(battle);

        assertEquals(2, events.size());
        assertEquals(30f, events.get(0).timeSec());
        assertEquals(2, events.get(0).victimTeam());
        assertEquals(1, events.get(0).beneficiaryTeam());
        assertEquals(60f, events.get(1).timeSec());
        assertEquals(1, events.get(1).victimTeam());
        assertEquals(2, events.get(1).beneficiaryTeam());
    }

    @Test
    void killPointsTimelineEmptyForNullBattleOrNoDeaths() {
        assertTrue(PointsSituationSkill.killPointsTimeline(null).isEmpty());
        final Battle battle = new Battle();
        battle.players = List.of(survivor(1), survivor(2));
        assertTrue(PointsSituationSkill.killPointsTimeline(battle).isEmpty());
    }

    @Test
    void capturePresenceCountsDistinctVehiclesPerTeamPerBin() {
        // raw (0,0) → canonical (250,250) → 5 区（中心）
        final VehicleTrack team1A = new VehicleTrack(101, 1, List.of(
                new PositionSample(5f, 0f, 0f),
                new PositionSample(20f, 0f, 0f),
                new PositionSample(40f, 0f, 0f)));
        final VehicleTrack team1B = new VehicleTrack(102, 1, List.of(
                new PositionSample(25f, 0f, 0f)));
        // 5 区外样本（raw -200,200 → 1 区）不计入
        final VehicleTrack team2A = new VehicleTrack(201, 2, List.of(
                new PositionSample(30f, -200f, 200f),
                new PositionSample(35f, 0f, 0f)));

        final List<CapturePresence> presence = PointsSituationSkill.capturePresence(
                List.of(team1A, team1B, team2A), Set.of("5"), MAP, 15f);

        assertEquals(3, presence.size());
        assertEquals(new CapturePresence(0f, 15f, 1, 0), presence.get(0));
        assertEquals(new CapturePresence(15f, 30f, 2, 0), presence.get(1));
        assertEquals(new CapturePresence(30f, 45f, 1, 1), presence.get(2));
    }

    @Test
    void capturePresenceEmptyWithoutControlRegionsOrTracks() {
        final VehicleTrack track = new VehicleTrack(101, 1,
                List.of(new PositionSample(5f, 0f, 0f)));
        assertTrue(PointsSituationSkill.capturePresence(List.of(track), Set.of(), MAP, 15f).isEmpty());
        assertTrue(PointsSituationSkill.capturePresence(List.of(), Set.of("5"), MAP, 15f).isEmpty());
        assertTrue(PointsSituationSkill.capturePresence(null, Set.of("5"), MAP, 15f).isEmpty());
    }

    @Test
    void pushWindowSpansMovingApproachAndPresence() {
        // x=-120..-90 → 4 区（移动接近），x=-80 起进入 5 区并停留
        final VehicleTrack track = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -100f, 0f),
                new PositionSample(4f, -90f, 0f),
                new PositionSample(6f, -80f, 0f),
                new PositionSample(8f, -70f, 0f),
                new PositionSample(10f, -60f, 0f),
                new PositionSample(12f, -40f, 0f)));

        final List<PushWindow> windows = PointsSituationSkill.pushWindows(
                List.of(track), Set.of("5"), MAP);

        assertEquals(1, windows.size());
        final PushWindow window = windows.get(0);
        assertEquals(0f, window.startSec());
        assertEquals(12f, window.endSec());
        assertEquals(1, window.team());
        assertEquals(List.of(101L), window.accountIds());
        assertEquals(5, window.targetRegion());
    }

    @Test
    void pushWindowStartClampedToLastMovingSample() {
        // 接近段静止（位移 < 4m），进入时刻即窗口开始
        final VehicleTrack track = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -121f, 0f),   // 1m → 静止
                new PositionSample(4f, -80f, 0f),    // 进入 5 区
                new PositionSample(6f, -70f, 0f)));

        final List<PushWindow> windows = PointsSituationSkill.pushWindows(
                List.of(track), Set.of("5"), MAP);

        assertEquals(1, windows.size());
        assertEquals(4f, windows.get(0).startSec());
        assertEquals(6f, windows.get(0).endSec());
    }

    @Test
    void pushWindowIgnoresStartInsideAndStreamGap() {
        // 起点已在 5 区：无「从外进入」证据；随后跨 10s 断线再进入：无窗口
        final VehicleTrack inside = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, 0f, 0f),
                new PositionSample(2f, 10f, 0f)));
        final VehicleTrack gapped = new VehicleTrack(102, 2, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(10f, -80f, 0f)));

        final List<PushWindow> windows = PointsSituationSkill.pushWindows(
                List.of(inside, gapped), Set.of("5"), MAP);

        assertTrue(windows.isEmpty());
    }

    @Test
    void pushWindowsMergeSameTeamOverlappingWindows() {
        // 两辆车同队、时间重叠 → 合并为一个窗口，车辆去重并集
        final VehicleTrack first = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -80f, 0f),
                new PositionSample(4f, -70f, 0f)));
        final VehicleTrack second = new VehicleTrack(102, 1, List.of(
                new PositionSample(2f, -120f, 0f),
                new PositionSample(4f, -80f, 0f),
                new PositionSample(6f, -70f, 0f),
                new PositionSample(8f, -60f, 0f)));

        final List<PushWindow> windows = PointsSituationSkill.pushWindows(
                List.of(first, second), Set.of("5"), MAP);

        assertEquals(1, windows.size());
        assertEquals(2, windows.get(0).accountIds().size());
        assertTrue(windows.get(0).accountIds().contains(101L));
        assertTrue(windows.get(0).accountIds().contains(102L));
        // 首车进入前无移动样本 → 起点=进入时刻 2s；两窗重叠合并
        assertEquals(2f, windows.get(0).startSec());
        assertEquals(8f, windows.get(0).endSec());
    }

    @Test
    void pushWindowsEmptyWithoutControlRegions() {
        final VehicleTrack track = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -80f, 0f)));
        assertTrue(PointsSituationSkill.pushWindows(List.of(track), Set.of(), MAP).isEmpty());
    }

    @Test
    void boundaryJitterBelowMoveThresholdDoesNotCreatePushWindow() {
        // 九宫格边界两侧（canonical x=166.67）：x=-84 → 4 区，x=-83 → 5 区，位移仅 1m < 4m
        // 坐标抖动/边界小幅移动不得生成推进窗口；位移达标（14m）的跨越仍正常生成
        final VehicleTrack jitter = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -84f, 0f),
                new PositionSample(2f, -83f, 0f),
                new PositionSample(4f, -70f, 0f)));
        final List<PushWindow> jitterWindows = PointsSituationSkill.pushWindows(
                List.of(jitter), Set.of("5"), MAP);
        assertTrue(jitterWindows.isEmpty(), "1m 边界抖动不得生成推进窗口");

        final VehicleTrack moving = new VehicleTrack(102, 1, List.of(
                new PositionSample(0f, -84f, 0f),
                new PositionSample(2f, -70f, 0f)));
        final List<PushWindow> movingWindows = PointsSituationSkill.pushWindows(
                List.of(moving), Set.of("5"), MAP);
        assertEquals(1, movingWindows.size());
        assertEquals(2f, movingWindows.get(0).startSec());
        assertEquals(2f, movingWindows.get(0).endSec());
        assertEquals(5, movingWindows.get(0).targetRegion());
    }

    @Test
    void sameTeamEnteringDifferentTargetRegionsKeepsTwoWindows() {
        // 同队两辆车分别进入 5 区（从 2 区）与 4 区（从 1 区），时间重叠：
        // 目标区域不同 → 不得合并，必须产出两个独立推进窗口
        final VehicleTrack toFive = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -80f, 120f),   // 2 区（非占领点区域）
                new PositionSample(2f, -80f, 0f)));    // 5 区
        final VehicleTrack toFour = new VehicleTrack(102, 1, List.of(
                new PositionSample(0f, -120f, 120f),  // 1 区（非占领点区域）
                new PositionSample(2f, -120f, 0f)));   // 4 区

        final List<PushWindow> windows = PointsSituationSkill.pushWindows(
                List.of(toFive, toFour), Set.of("4", "5"), MAP);

        assertEquals(2, windows.size(), "不同目标区域不得合并");
        final Set<Integer> regions = windows.stream()
                .map(PushWindow::targetRegion).collect(java.util.stream.Collectors.toSet());
        assertEquals(Set.of(4, 5), regions);
        assertEquals(1, windows.stream().filter(w -> w.targetRegion() == 5).findFirst()
                .orElseThrow().accountIds().size());
        assertEquals(1, windows.stream().filter(w -> w.targetRegion() == 4).findFirst()
                .orElseThrow().accountIds().size());
    }
}
