package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.PointsSituationSkill;
import com.wotb.core.replay.evidence.PointsSituationSkill.CapturePresence;
import com.wotb.core.replay.evidence.PointsSituationSkill.ControlRegionEntryWindow;
import com.wotb.core.replay.evidence.PointsSituationSkill.KillPointsEvent;
import com.wotb.core.replay.evidence.PointsSituationSkill.PositionSample;
import com.wotb.core.replay.evidence.PointsSituationSkill.VehicleTrack;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PointsSituationSkillTest {

    private static final String MAP = "test-map";

    private static PlayerResult deadPlayer(final int team, final long deathTimeMillis) {
        final PlayerResult player = new PlayerResult();
        player.team = team;
        player.survived = false;
        player.deathTimeMillis = deathTimeMillis;
        player.settlementLifeTimeSec = deathTimeMillis / 1000.0;
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
                deadPlayer(3, 15_000L),
                deadPlayer(1, 0L));

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
        final VehicleTrack team1A = new VehicleTrack(101, 1, List.of(
                new PositionSample(5f, 0f, 0f),
                new PositionSample(20f, 0f, 0f),
                new PositionSample(40f, 0f, 0f)));
        final VehicleTrack team1B = new VehicleTrack(102, 1, List.of(
                new PositionSample(25f, 0f, 0f)));
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
        final VehicleTrack track = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -100f, 0f),
                new PositionSample(4f, -90f, 0f),
                new PositionSample(6f, -80f, 0f),
                new PositionSample(8f, -70f, 0f),
                new PositionSample(10f, -60f, 0f),
                new PositionSample(12f, -40f, 0f)));

        final List<ControlRegionEntryWindow> windows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(track), Set.of("5"), MAP);

        assertEquals(1, windows.size());
        final ControlRegionEntryWindow window = windows.get(0);
        assertEquals(0f, window.startSec());
        assertEquals(12f, window.endSec());
        assertEquals(1, window.team());
        assertEquals(List.of(101L), window.accountIds());
        assertEquals(5, window.targetRegion());
    }

    @Test
    void pushWindowStartClampedToLastMovingSample() {
        final VehicleTrack track = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -121f, 0f),
                new PositionSample(4f, -80f, 0f),
                new PositionSample(6f, -70f, 0f)));

        final List<ControlRegionEntryWindow> windows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(track), Set.of("5"), MAP);

        assertEquals(1, windows.size());
        assertEquals(4f, windows.get(0).startSec());
        assertEquals(6f, windows.get(0).endSec());
    }

    @Test
    void pushWindowIgnoresStartInsideAndStreamGap() {
        final VehicleTrack inside = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, 0f, 0f),
                new PositionSample(2f, 10f, 0f)));
        final VehicleTrack gapped = new VehicleTrack(102, 2, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(10f, -80f, 0f)));

        final List<ControlRegionEntryWindow> windows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(inside, gapped), Set.of("5"), MAP);

        assertTrue(windows.isEmpty());
    }

    @Test
    void entryWindowsMergeSameTeamOverlappingWindows() {
        final VehicleTrack first = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -80f, 0f),
                new PositionSample(4f, -70f, 0f)));
        final VehicleTrack second = new VehicleTrack(102, 1, List.of(
                new PositionSample(2f, -120f, 0f),
                new PositionSample(4f, -80f, 0f),
                new PositionSample(6f, -70f, 0f),
                new PositionSample(8f, -60f, 0f)));

        final List<ControlRegionEntryWindow> windows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(first, second), Set.of("5"), MAP);

        assertEquals(1, windows.size());
        assertEquals(2, windows.get(0).accountIds().size());
        assertTrue(windows.get(0).accountIds().contains(101L));
        assertTrue(windows.get(0).accountIds().contains(102L));
        assertEquals(2f, windows.get(0).startSec());
        assertEquals(8f, windows.get(0).endSec());
    }

    @Test
    void entryWindowsEmptyWithoutControlRegions() {
        final VehicleTrack track = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -120f, 0f),
                new PositionSample(2f, -80f, 0f)));
        assertTrue(PointsSituationSkill.controlRegionEntryWindows(List.of(track), Set.of(), MAP).isEmpty());
    }

    @Test
    void boundaryJitterBelowMoveThresholdDoesNotCreateEntryWindow() {
        final VehicleTrack jitter = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -84f, 0f),
                new PositionSample(2f, -83f, 0f),
                new PositionSample(4f, -70f, 0f)));
        final List<ControlRegionEntryWindow> jitterWindows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(jitter), Set.of("5"), MAP);
        assertTrue(jitterWindows.isEmpty(), "1m 边界抖动不得生成推进窗口");

        final VehicleTrack moving = new VehicleTrack(102, 1, List.of(
                new PositionSample(0f, -84f, 0f),
                new PositionSample(2f, -70f, 0f)));
        final List<ControlRegionEntryWindow> movingWindows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(moving), Set.of("5"), MAP);
        assertEquals(1, movingWindows.size());
        assertEquals(2f, movingWindows.get(0).startSec());
        assertEquals(2f, movingWindows.get(0).endSec());
        assertEquals(5, movingWindows.get(0).targetRegion());
    }

    @Test
    void sameTeamEnteringDifferentTargetRegionsKeepsTwoWindows() {
        final VehicleTrack toFive = new VehicleTrack(101, 1, List.of(
                new PositionSample(0f, -80f, 120f),
                new PositionSample(2f, -80f, 0f)));
        final VehicleTrack toFour = new VehicleTrack(102, 1, List.of(
                new PositionSample(0f, -120f, 120f),
                new PositionSample(2f, -120f, 0f)));

        final List<ControlRegionEntryWindow> windows = PointsSituationSkill.controlRegionEntryWindows(
                List.of(toFive, toFour), Set.of("4", "5"), MAP);

        assertEquals(2, windows.size(), "不同目标区域不得合并");
        final Set<Integer> regions = windows.stream()
                .map(ControlRegionEntryWindow::targetRegion).collect(java.util.stream.Collectors.toSet());
        assertEquals(Set.of(4, 5), regions);
        assertEquals(1, windows.stream().filter(w -> w.targetRegion() == 5).findFirst()
                .orElseThrow().accountIds().size());
        assertEquals(1, windows.stream().filter(w -> w.targetRegion() == 4).findFirst()
                .orElseThrow().accountIds().size());
    }
}
