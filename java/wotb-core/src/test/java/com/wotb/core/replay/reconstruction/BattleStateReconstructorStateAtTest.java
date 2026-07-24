package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * stateAt 在时钟回退（clock regression）下的正确性：
 * 不能因为遇到第一个"晚于目标时间"的事件就停止，否则其后 sequence 更大、
 * 但时钟更早的事件会被漏掉。
 */
class BattleStateReconstructorStateAtTest {

    private static DamageEvent dmg(int seq, float clock, int attacker, int victim, int damage) {
        return new DamageEvent(seq, new ReplayTimestamp(clock, clock), 8,
                DecodeConfidence.EXACT, attacker, victim, null, null, damage, false);
    }

    private static int received(BattleStateSnapshot snap, int entityId) {
        final VehicleState vs = snap.vehiclesByEntityId().get(entityId);
        assertNotNull(vs, "vehicle " + entityId + " missing");
        return vs.damageReceived();
    }

    @Test
    void appliesLaterSequenceEventWithEarlierClock() {
        // seq2 的时钟(15) 早于 seq1(20)，构成时钟回退
        final List<ReplayEvent> events = List.of(
                dmg(0, 10f, 1, 2, 100),
                dmg(1, 20f, 1, 2, 50),
                dmg(2, 15f, 1, 2, 30));

        // 查询 t=15：应包含 clock<=15 的 seq0(10) 与 seq2(15)，跳过 seq1(20)
        final BattleStateSnapshot at15 =
                BattleStateReconstructor.stateAt(15f, events, List.of());
        // 修复前会在 seq1 处 break，漏掉 seq2 → 只有 100；修复后为 130
        assertEquals(130, received(at15, 2));
    }

    @Test
    void includesAllEventsUpToTarget() {
        final List<ReplayEvent> events = List.of(
                dmg(0, 10f, 1, 2, 100),
                dmg(1, 20f, 1, 2, 50),
                dmg(2, 15f, 1, 2, 30));

        assertEquals(180, received(
                BattleStateReconstructor.stateAt(20f, events, List.of()), 2));
    }

    @Test
    void emptyBeforeFirstEvent() {
        final List<ReplayEvent> events = List.of(dmg(0, 10f, 1, 2, 100));
        final BattleStateSnapshot at5 =
                BattleStateReconstructor.stateAt(5f, events, List.of());
        assertEquals(0, at5.vehiclesByEntityId().size());
    }
}
