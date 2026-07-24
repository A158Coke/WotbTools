package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.reconstruction.BattleLifecycle;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 18.5: PlayerBattleFeatureExtractor 测试。
 * - 只处理 recorder entity
 * - damage dealt/received 正确区分
 * - MovementSegment 压缩
 */
class PlayerBattleFeatureExtractorTest {

    private final DefaultPlayerBattleFeatureExtractor extractor = new DefaultPlayerBattleFeatureExtractor();

    private static PositionChangedEvent pos(int seq, float time, int entityId, float x, float z) {
        return new PositionChangedEvent(seq, new ReplayTimestamp(time, null), 10, DecodeConfidence.EXACT,
                entityId, 0, 0, x, 0, z, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    private static DamageEvent dmg(int seq, float time, int attacker, int victim, int damage) {
        return new DamageEvent(seq, new ReplayTimestamp(time, null), 8, DecodeConfidence.EXACT,
                attacker, victim, null, null, damage, false);
    }

    @Test
    void onlyProcessesRecorderEntity() {
        final int RECORDER_EID = 10;
        final int OTHER_EID = 20;
        final var events = List.of(
                pos(1, 10f, RECORDER_EID, 0, 0),
                pos(2, 11f, RECORDER_EID, 10, 10),
                pos(3, 12f, OTHER_EID, 100, 100)     // 不应进入 recorder feature
        );
        final var recon = buildRecon(events, RECORDER_EID);
        final var mapping = new RecorderEntityMapping(1000L, 1, RECORDER_EID, "Recorder", 1, 0, DecodeConfidence.EXACT);
        final PlayerBattleFeatureSet fs = extractor.extract(recon, mapping);
        // 移动段不应包含 OTHER_EID 的位置
        for (final MovementSegment seg : fs.movements()) {
            // 所有段的坐标范围应在 0-10 之间（recorder 轨迹）
            assertTrue(seg.startPosition().x() <= 10 || seg.startPosition().x() == 0);
        }
    }

    @Test
    void damageDealtAndReceivedCorrectlySeparated() {
        final int RECORDER_EID = 10;
        final int ENEMY_EID = 20;
        final var events = List.of(
                dmg(1, 20f, RECORDER_EID, ENEMY_EID, 200),  // recorder 造成 200
                dmg(2, 25f, ENEMY_EID, RECORDER_EID, 150),  // recorder 承受 150
                dmg(3, 30f, RECORDER_EID, 99, 100)          // recorder 造成 100
        );
        final var recon = buildRecon(events, RECORDER_EID);
        final var mapping = new RecorderEntityMapping(1000L, 1, RECORDER_EID, "Recorder", 1, 0, DecodeConfidence.EXACT);
        final PlayerBattleFeatureSet fs = extractor.extract(recon, mapping);

        int totalDealt = 0, totalReceived = 0;
        for (final EngagementSummary eng : fs.engagements()) {
            totalDealt += eng.damageDealt();
            totalReceived += eng.damageReceived();
        }
        assertEquals(300, totalDealt);
        assertEquals(150, totalReceived);
    }

    @Test
    void movementSegmentsAreCompressed() {
        final int EID = 10;
        final var events = List.of(
                pos(1, 10f, EID, 0, 0),
                pos(2, 10.1f, EID, 0.1f, 0.1f),    // 几乎不动 → STATIONARY
                pos(3, 15f, EID, 50, 0),             // 移动 → MOVING
                pos(4, 15.1f, EID, 52, 0),
                pos(5, 20f, EID, 52, 0)              // 停了 → STATIONARY
        );
        final var recon = buildRecon(events, EID);
        final var mapping = new RecorderEntityMapping(1000L, 1, EID, "Recorder", 1, 0, DecodeConfidence.EXACT);
        final PlayerBattleFeatureSet fs = extractor.extract(recon, mapping);
        // 至少有一个 movement segment
        assertFalse(fs.movements().isEmpty());
        // 段数量应远少于位置事件数（压缩有效）
        assertTrue(fs.movements().size() < events.size());
    }

    @Test
    void unmappedRecorderReturnsEmpty() {
        final int EID = 10;
        final var events = List.of(pos(1, 10f, EID, 0, 0));
        final var recon = buildRecon(events, EID);
        final PlayerBattleFeatureSet fs = extractor.extract(recon, null);
        assertNotNull(fs);
        assertTrue(fs.limitations().contains("recorder") || fs.movements().isEmpty());
    }

    // ---- 辅助 ----

    private static ReplayReconstruction buildRecon(List<? extends com.wotb.core.replay.event.ReplayEvent> events, int recorderEid) {
        final var state = BattleStateSnapshot.empty();
        return new ReplayReconstruction(null, null, 60f, 5f,
                List.of(new BattleParticipant(1000L, "Recorder", 1, 0, "T-34", true)),
                List.copyOf(events), List.of(), state, null, null);
    }
}