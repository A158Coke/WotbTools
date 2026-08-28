package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.AmmunitionStateEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ProjectileLaunchedEvent;
import com.wotb.core.replay.event.ProjectileTerminalEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** ShotLifecycle（C1）：recorder 过滤、ammo join、method38 配对。 */
class ShotLifecycleTest {

    private static ReplayTimestamp ts(final float raw) {
        return new ReplayTimestamp(raw, null);
    }

    private static TeamEntityMapping mapping(final long recorderAccount) {
        final Battle battle = new Battle();
        final PlayerResult p = new PlayerResult();
        p.accountId = recorderAccount;
        p.team = 1;
        p.nickname = "rec";
        battle.players = List.of(p);
        battle.recorder = "rec";
        final List<ReplayEvent> events = List.of(
                new ParticipantMappingEvent(1, ts(1f), 8, DecodeConfidence.EXACT,
                        10, recorderAccount, "rec", 1),
                new ParticipantMappingEvent(2, ts(1f), 8, DecodeConfidence.EXACT,
                        20, 2001L, "enemy", 2));
        return TeamEntityMapper.resolve(battle, new ReplayReconstruction(
                null, null, 100f, 0f, List.of(), events, List.of(), null, null, null));
    }

    @Test
    void recorderFilterAndAmmoJoin() {
        final long recorderAccount = 1001L;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, ts(1f), 8, DecodeConfidence.EXACT,
                10, recorderAccount, "rec", 1));
        events.add(new ParticipantMappingEvent(2, ts(1f), 8, DecodeConfidence.EXACT,
                20, 2001L, "enemy", 2));
        events.add(new AmmunitionSelectionChangedEvent(3, ts(5f), 28,
                DecodeConfidence.EXACT, 1));
        events.add(new AmmunitionStateEvent(4, ts(6f), 8, DecodeConfidence.EXACT,
                10, 0x003C5A0A, 0, 16, new byte[6]));
        events.add(new ProjectileLaunchedEvent(5, ts(7f), 8, DecodeConfidence.EXACT,
                10, 9001, 0, new Vector3(1f, 2f, 3f),
                new Vector3(100f, 0f, 0f), 0f));
        events.add(new ProjectileLaunchedEvent(6, ts(7.5f), 8, DecodeConfidence.EXACT,
                20, 9002, 0, new Vector3(2f, 2f, 3f),
                new Vector3(50f, 0f, 0f), 0f));
        events.add(new ProjectileTerminalEvent(7, ts(8f), 8, DecodeConfidence.EXACT,
                9001, new Vector3(50f, 10f, 20f)));
        events.add(new ShotResultEvent(8, ts(7.1f), 8, DecodeConfidence.EXACT,
                55, 0x0210, 0x0002, List.of(), List.of()));

        final List<ShotFact> shots = ShotLifecycle.build(events, mapping(recorderAccount),
                recorderAccount, 0.0);
        assertEquals(2, shots.size());
        final ShotFact recorderShot = shots.get(0);
        assertTrue(recorderShot.recorderShot());
        assertEquals(1001L, recorderShot.shooterAccountId());
        assertEquals(1, recorderShot.ammoSelection());
        assertEquals(0x003C5A0A, recorderShot.ammoDescriptorRaw());
        assertEquals(8.0, recorderShot.terminalTimeSec(), 1e-9);
        assertEquals(50f, recorderShot.terminalPosition().x());
        assertEquals(0x0210, recorderShot.resolution().rawFlags16());

        final ShotFact enemyShot = shots.get(1);
        assertFalse(enemyShot.recorderShot(), "method29 是全局流：shooter=20 不得算 recorder 射击");
        assertNull(enemyShot.terminalTimeSec(), "9002 无 method20 → terminal UNKNOWN");
        assertNull(enemyShot.resolution(), "method38 窗口内多发射（7s 与 7.5s）→ 不唯一配对");
    }
    private static ShotFact shotOf(final List<ShotFact> shots, final int shotId) {
        for (final ShotFact s : shots) {
            if (s.shotId() == shotId) {
                return s;
            }
        }
        throw new AssertionError("shot missing: " + shotId);
    }

    @Test
    void rapidFireSameClockPairsPerShot() {
        // 3 条 recorder launch 同一 rawClock + 3 条 method38 同一 rawClock → 按 sequence 顺序逐发关联
        final long recorderAccount = 1001L;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, ts(1f), 8, DecodeConfidence.EXACT,
                10, recorderAccount, "rec", 1));
        events.add(new ProjectileLaunchedEvent(2, ts(10f), 8, DecodeConfidence.EXACT,
                10, 9001, 0, new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f), 0f));
        events.add(new ProjectileLaunchedEvent(3, ts(10f), 8, DecodeConfidence.EXACT,
                10, 9002, 0, new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f), 0f));
        events.add(new ProjectileLaunchedEvent(4, ts(10f), 8, DecodeConfidence.EXACT,
                10, 9003, 0, new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f), 0f));
        events.add(new ShotResultEvent(5, ts(10f), 8, DecodeConfidence.EXACT,
                55, 0x0010, 0, List.of(), List.of()));
        events.add(new ShotResultEvent(6, ts(10f), 8, DecodeConfidence.EXACT,
                55, 0x0020, 0, List.of(), List.of()));
        events.add(new ShotResultEvent(7, ts(10f), 8, DecodeConfidence.EXACT,
                55, 0x0040, 0, List.of(), List.of()));
        final List<ShotFact> shots = ShotLifecycle.build(events, mapping(recorderAccount),
                recorderAccount, 0.0);
        assertEquals(3, shots.size());
        assertEquals(0x0010, shotOf(shots, 9001).resolution().rawFlags16(),
                "第 1 发射(seq2) ↔ 第 1 个 result(seq5)");
        assertEquals(0x0020, shotOf(shots, 9002).resolution().rawFlags16(),
                "第 2 发射(seq3) ↔ 第 2 个 result(seq6)");
        assertEquals(0x0040, shotOf(shots, 9003).resolution().rawFlags16(),
                "第 3 发射(seq4) ↔ 第 3 个 result(seq7)");
    }

    @Test
    void qubyControlledEquivalentPairsAllThirty() {
        // Quby→Maus 等价：30 recorder launch 与 30 method38 各在相同 rawClock（30/30 same-clock pairs）
        final long recorderAccount = 1001L;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, ts(1f), 8, DecodeConfidence.EXACT,
                10, recorderAccount, "rec", 1));
        int seq = 2;
        for (int i = 0; i < 30; i++) {
            final float clock = 1.0f + i * 0.1f;
            events.add(new ProjectileLaunchedEvent(seq++, ts(clock), 8, DecodeConfidence.EXACT,
                    10, 9000 + i, 0, new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f), 0f));
        }
        for (int i = 0; i < 30; i++) {
            final float clock = 1.0f + i * 0.1f;
            events.add(new ShotResultEvent(seq++, ts(clock), 8, DecodeConfidence.EXACT,
                    55, 0x0001 + i, 0, List.of(), List.of()));
        }
        final List<ShotFact> shots = ShotLifecycle.build(events, mapping(recorderAccount),
                recorderAccount, 0.0);
        assertEquals(30, shots.size());
        int paired = 0;
        for (final ShotFact s : shots) {
            if (s.resolution() != null) {
                paired++;
            }
        }
        assertEquals(30, paired, "Quby 等价：30 launch / 30 同刻 result → 30/30 deterministic 配对");
    }

    @Test
    void ambiguousSameClockCountMismatchIsUnknown() {
        final long recorderAccount = 1001L;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, ts(1f), 8, DecodeConfidence.EXACT,
                10, recorderAccount, "rec", 1));
        events.add(new ProjectileLaunchedEvent(2, ts(10f), 8, DecodeConfidence.EXACT,
                10, 9001, 0, new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f), 0f));
        events.add(new ShotResultEvent(3, ts(10f), 8, DecodeConfidence.EXACT,
                55, 0x0410, 0, List.of(), List.of()));
        events.add(new ShotResultEvent(4, ts(10f), 8, DecodeConfidence.EXACT,
                55, 0x0420, 0, List.of(), List.of()));
        final List<ShotFact> shots = ShotLifecycle.build(events, mapping(recorderAccount),
                recorderAccount, 0.0);
        assertEquals(1, shots.size());
        assertNull(shotOf(shots, 9001).resolution(),
                "1 发射 vs 2 同刻 result → 计数不等 → ambiguity → UNKNOWN");
    }

    @Test
    void nonRecorderLaunchNeverConsumesRecorderResult() {
        final long recorderAccount = 1001L;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, ts(1f), 8, DecodeConfidence.EXACT,
                10, recorderAccount, "rec", 1));
        events.add(new ParticipantMappingEvent(2, ts(1f), 8, DecodeConfidence.EXACT,
                20, 2001L, "enemy", 2));
        // enemy method29（shooter=20）与 recorder-local method38 result 同刻 → 也绝不消费
        events.add(new ProjectileLaunchedEvent(3, ts(10f), 8, DecodeConfidence.EXACT,
                20, 9002, 0, new Vector3(1f, 2f, 3f), new Vector3(100f, 0f, 0f), 0f));
        events.add(new ShotResultEvent(4, ts(10f), 8, DecodeConfidence.EXACT,
                55, 0x0410, 0, List.of(), List.of()));
        final List<ShotFact> shots = ShotLifecycle.build(events, mapping(recorderAccount),
                recorderAccount, 0.0);
        assertEquals(1, shots.size());
        assertNotNull(shots.get(0));
        assertFalse(shots.get(0).recorderShot());
        assertNull(shots.get(0).resolution(),
                "non-recorder method29 永远不得消费 recorder-local method38");
    }
}
