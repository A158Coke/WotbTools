package com.wotb.core.ai;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * LEVEL_3 / LEVEL_4 的 observation 边界约束：
 * 只有 observationState == OBSERVED 才能作为当前位置输出；
 * 首次进入 STALE/UNKNOWN/REMOVED 时输出一次最近一次 OBSERVED 样本作为 LAST_KNOWN_POSITION。
 */
class SingleReplayPromptPlannerObservationBoundaryTest {

    private static final long RECORDER_ACCOUNT_ID = 1000L;
    private static final long ENEMY_ACCOUNT_ID = 2000L;
    private static final int ENEMY_ENTITY_ID = 7;
    private static final float BATTLE_START = 0f;

    // halfExtent=250, scale=1.0 → canonical = raw + 250
    private static final Vector3 RAW_FIRST = new Vector3(-100f, 0f, -100f);   // canonical 150.0 / 150.0
    private static final Vector3 RAW_LAST = new Vector3(50f, 0f, 60f);        // canonical 300.0 / 310.0
    private static final Vector3 RAW_BETWEEN = new Vector3(100f, 0f, -20f);   // canonical 350.0 / 230.0
    private static final Vector3 RAW_STALE = new Vector3(200f, 0f, 200f);     // canonical 450.0 / 450.0

    // ---- LEVEL_3 ----

    @Test
    void level3LastKnownPositionUsesLastObservedSampleNotFirst() {
        final String out = buildLevel3(List.of(
                // 首个 OBSERVED 之前处于 UNKNOWN，不得输出任何最后已知位置
                checkpoint(0.5f, enemy(0.5f, ObservationState.UNKNOWN, RAW_FIRST)),
                checkpoint(1.0f, enemy(1.0f, ObservationState.OBSERVED, RAW_FIRST)),
                checkpoint(3.0f, enemy(3.0f, ObservationState.OBSERVED, RAW_LAST)),
                checkpoint(5.0f, enemy(5.0f, ObservationState.STALE, RAW_STALE))));

        // 两次 OBSERVED 都作为当前位置正常输出
        assertTrue(out.contains(currentLine(1.0f, 150f, 150f)), out);
        assertTrue(out.contains(currentLine(3.0f, 300f, 310f)), out);

        // LAST_KNOWN_POSITION 取最后一次 OBSERVED（t=3.0s / 300.0,310.0），而不是第一次（150.0,150.0）
        assertTrue(out.contains(lastKnownCoords(300f, 310f)), out);
        assertFalse(out.contains(lastKnownCoords(150f, 150f)), out);
        assertTrue(out.contains(String.format("t=%.1fs entity=E%d", 3.0f, ENEMY_ENTITY_ID)
                + String.format(" coordinateStatus=VALID canonicalX=%.1f canonicalZ=%.1f LAST_KNOWN_POSITION", 300f, 310f)), out);

        // 明确此后位置未知，并标注触发的状态与时刻
        assertTrue(out.contains("observationState=STALE"), out);
        assertTrue(out.contains(String.format("POSITION_UNKNOWN_AFTER=%.1fs", 5.0f)), out);
        assertTrue(out.contains("此后位置未知"), out);
    }

    @Test
    void level3StaleIsNeverEmittedAsCurrentPosition() {
        final String out = buildLevel3(List.of(
                checkpoint(1.0f, enemy(1.0f, ObservationState.OBSERVED, RAW_FIRST)),
                checkpoint(3.0f, enemy(3.0f, ObservationState.OBSERVED, RAW_LAST)),
                checkpoint(5.0f, enemy(5.0f, ObservationState.STALE, RAW_STALE))));

        // STALE 时刻的坐标（450.0,450.0）不得以任何形式出现
        assertFalse(out.contains(String.format("canonicalX=%.1f", 450f)), out);
        assertFalse(out.contains(currentLine(5.0f, 450f, 450f)), out);
    }

    @Test
    void level3LastKnownPositionEmittedOnlyOnce() {
        final String out = buildLevel3(List.of(
                checkpoint(1.0f, enemy(1.0f, ObservationState.OBSERVED, RAW_FIRST)),
                checkpoint(3.0f, enemy(3.0f, ObservationState.OBSERVED, RAW_LAST)),
                checkpoint(5.0f, enemy(5.0f, ObservationState.STALE, RAW_STALE)),
                checkpoint(7.0f, enemy(7.0f, ObservationState.UNKNOWN, RAW_STALE)),
                checkpoint(9.0f, enemy(9.0f, ObservationState.REMOVED, RAW_STALE))));

        assertEquals(1, countOccurrences(out, "LAST_KNOWN_POSITION"), out);
    }

    // ---- LEVEL_4 ----

    @Test
    void level4LastKnownPositionUsesLastObservedAndSkipsStaleAsCurrent() {
        final String out = buildLevel4(
                List.of(
                        checkpoint(1.0f, enemy(1.0f, ObservationState.OBSERVED, RAW_FIRST)),
                        checkpoint(3.0f, enemy(3.0f, ObservationState.OBSERVED, RAW_LAST)),
                        checkpoint(5.0f, enemy(5.0f, ObservationState.STALE, RAW_STALE)),
                        checkpoint(7.0f, enemy(7.0f, ObservationState.REMOVED, RAW_STALE))),
                List.of(5.0f));

        // OBSERVED 作为当前位置输出
        assertTrue(out.contains(String.format("entity=E%d coordinateStatus=VALID canonicalX=%.1f canonicalZ=%.1f",
                ENEMY_ENTITY_ID, 300f, 310f)), out);

        // 最后已知位置取 t=3.0s 的样本，不是 t=1.0s 的第一次 OBSERVED
        assertTrue(out.contains(lastKnownCoords(300f, 310f)), out);
        assertFalse(out.contains(lastKnownCoords(150f, 150f)), out);
        assertTrue(out.contains(String.format("lastObserved=%.1fs", 3.0f)), out);

        // STALE 坐标不得作为当前位置泄漏，且只输出一次最后已知位置
        assertFalse(out.contains(String.format("canonicalX=%.1f", 450f)), out);
        assertEquals(1, countOccurrences(out, "LAST_KNOWN_POSITION"), out);
        assertTrue(out.contains("此后位置未知"), out);
    }

    @Test
    void level4TracksObservedSamplesBetweenKeyWindows() {
        // 两个关键窗口：[0,7] 与 [15,25]；t=12 的 OBSERVED 落在窗口之间，
        // 必须仍被纳入维护，否则最后已知位置会退回到 t=3.0s 的旧样本。
        final String out = buildLevel4(
                List.of(
                        checkpoint(1.0f, enemy(1.0f, ObservationState.OBSERVED, RAW_FIRST)),
                        checkpoint(3.0f, enemy(3.0f, ObservationState.OBSERVED, RAW_LAST)),
                        checkpoint(12.0f, enemy(12.0f, ObservationState.OBSERVED, RAW_BETWEEN)),
                        checkpoint(16.0f, enemy(16.0f, ObservationState.STALE, RAW_STALE))),
                List.of(2.0f, 20.0f));

        assertTrue(out.contains(lastKnownCoords(350f, 230f)), out);
        assertTrue(out.contains(String.format("lastObserved=%.1fs", 12.0f)), out);
        assertFalse(out.contains(lastKnownCoords(300f, 310f)), out);
        assertFalse(out.contains(lastKnownCoords(150f, 150f)), out);
        assertEquals(1, countOccurrences(out, "LAST_KNOWN_POSITION"), out);
    }

    // ---- helpers ----

    private static String buildLevel3(final List<BattleStateCheckpoint> checkpoints) {
        return SingleReplayPromptPlanner.buildLevel3ObservedTimeline(
                reconstruction(checkpoints), context(List.of()), BATTLE_START);
    }

    private static String buildLevel4(final List<BattleStateCheckpoint> checkpoints,
                                      final List<Float> keyEventSecs) {
        return SingleReplayPromptPlanner.buildLevel4KeyWindowPrecision(
                reconstruction(checkpoints), context(keyEventSecs), BATTLE_START);
    }

    /** LEVEL_3 的当前位置输出行（不带 LAST_KNOWN_POSITION 标记）。 */
    private static String currentLine(final float relSec, final float canonicalX, final float canonicalZ) {
        return String.format("t=%.1fs entity=E%d coordinateStatus=VALID canonicalX=%.1f canonicalZ=%.1f%n",
                relSec, ENEMY_ENTITY_ID, canonicalX, canonicalZ);
    }

    private static String lastKnownCoords(final float canonicalX, final float canonicalZ) {
        return String.format("canonicalX=%.1f canonicalZ=%.1f LAST_KNOWN_POSITION", canonicalX, canonicalZ);
    }

    private static int countOccurrences(final String haystack, final String needle) {
        int count = 0;
        int idx = haystack.indexOf(needle);
        while (idx >= 0) {
            count++;
            idx = haystack.indexOf(needle, idx + needle.length());
        }
        return count;
    }

    private static VehicleState enemy(final float clock, final ObservationState state, final Vector3 pos) {
        final VehicleState vs = new VehicleState(ENEMY_ENTITY_ID, clock);
        vs.setAccountId(ENEMY_ACCOUNT_ID);
        vs.setLastObservedAt(clock);
        if (pos != null) {
            vs.setPosition(pos);
        }
        vs.setObservationState(state);
        return vs;
    }

    private static BattleStateCheckpoint checkpoint(final float clock, final VehicleState... vehicles) {
        final Map<Integer, VehicleState> byEntityId = new LinkedHashMap<>();
        final Map<Long, Integer> byAccountId = new LinkedHashMap<>();
        for (final VehicleState vs : vehicles) {
            byEntityId.put(vs.entityId(), vs);
            if (vs.accountId() != null) {
                byAccountId.put(vs.accountId(), vs.entityId());
            }
        }
        final BattleStateSnapshot snapshot = new BattleStateSnapshot(
                clock, clock, BattleLifecycle.IN_PROGRESS,
                byEntityId, byAccountId, List.of(), false, null);
        return new BattleStateCheckpoint(clock, 0, snapshot);
    }

    private static ReplayReconstruction reconstruction(final List<BattleStateCheckpoint> checkpoints) {
        return new ReplayReconstruction(
                null, null, 60f, BATTLE_START,
                List.of(), List.of(), checkpoints, null, null, null);
    }

    private static SinglePlayerBattleAnalysisContext context(final List<Float> keyEventSecs) {
        final List<KeyBattleEvent> keyEvents = keyEventSecs.stream()
                .map(sec -> new KeyBattleEvent(sec, "VEHICLE_DESTROYED", "test event",
                        DecodeConfidence.EXACT, "TEST", List.of(ENEMY_ENTITY_ID)))
                .toList();
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(), List.of(), List.of(), keyEvents, List.of(), true);
        final RecorderEntityMapping recorder = new RecorderEntityMapping(
                RECORDER_ACCOUNT_ID, 1, 1, "recorder", 1, 1, DecodeConfidence.EXACT);
        return new SinglePlayerBattleAnalysisContext(null, null, features, recorder, null, List.of());
    }
}
