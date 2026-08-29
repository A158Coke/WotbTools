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
 *
 * <p>观测代理（P1）：BattleStateReconstructor 收敛后不再用 DamageEvent.raw 累计
 * damageDealt/damageReceived（raw 不是 canonical HP-loss 事实，VehicleState 已移除该字段），
 * 这里用 {@link VehicleState#lastObservedAt()}（每次事件更新）作为「状态是否被回放」的可观测代理：
 * at15 应回放 seq0(10) 与 seq2(15)（后者 sequence 更大但 clock 更早）→ lastObservedAt=15；
 * 修复前会在 seq1(20) 处 break，漏掉 seq2 → lastObservedAt=10。</p>
 */
class BattleStateReconstructorStateAtTest {

    private static DamageEvent dmg(int seq, float clock, int attacker, int victim, int damage) {
        return new DamageEvent(seq, new ReplayTimestamp(clock, clock), 8,
                DecodeConfidence.EXACT, attacker, victim, null, null, damage, false);
    }

    private static float lastObserved(BattleStateSnapshot snap, int entityId) {
        final VehicleState vs = snap.vehiclesByEntityId().get(entityId);
        assertNotNull(vs, "vehicle " + entityId + " missing");
        return vs.lastObservedAt();
    }

    @Test
    void appliesLaterSequenceEventWithEarlierClock() {
        // seq2 的时钟(15) 早于 seq1(20)，构成时钟回退
        final List<ReplayEvent> events = List.of(
                dmg(0, 10f, 1, 2, 100),
                dmg(1, 20f, 1, 2, 50),
                dmg(2, 15f, 1, 2, 30));

        // 查询 t=15：应回放 clock<=15 的 seq0(10) 与 seq2(15)，跳过 seq1(20)
        final BattleStateSnapshot at15 =
                BattleStateReconstructor.stateAt(15f, events, List.of());
        // 修复前会在 seq1 处 break，漏掉 seq2 → lastObservedAt=10；修复后回放 seq2 → 15
        assertEquals(15f, lastObserved(at15, 2), 0.001f);
    }

    @Test
    void includesAllEventsUpToTarget() {
        final List<ReplayEvent> events = List.of(
                dmg(0, 10f, 1, 2, 100),
                dmg(1, 20f, 1, 2, 50),
                dmg(2, 15f, 1, 2, 30));

        // t=20：所有事件 clock<=20，按 sequence 顺序回放；最后一个回放的是 seq2(15)
        assertEquals(15f, lastObserved(
                BattleStateReconstructor.stateAt(20f, events, List.of()), 2), 0.001f);
    }

    @Test
    void emptyBeforeFirstEvent() {
        final List<ReplayEvent> events = List.of(dmg(0, 10f, 1, 2, 100));
        final BattleStateSnapshot at5 =
                BattleStateReconstructor.stateAt(5f, events, List.of());
        assertEquals(0, at5.vehiclesByEntityId().size());
    }
}
