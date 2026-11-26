package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReplayTerminalLifecycleTest {

    private static final int EID = 7;
    private static final long ACC = 1001L;

    private static TeamEntityMapping mapping() {
        return new TeamEntityMapping(
                Map.of(EID, new TeamEntityIdentity(EID, ACC, "A", 1, "T72", 1, DecodeConfidence.EXACT)),
                Map.of(ACC, List.of(EID)),
                0, List.of());
    }

    private static ReplayTimestamp ts(final float raw) {
        return new ReplayTimestamp(raw, null);
    }

    private static HealthChangedEvent hpTerminal(final int seq, final float raw, final HpRawState rawState) {
        return new HealthChangedEvent(seq, ts(raw), 7, DecodeConfidence.EXACT, EID,
                null, null, null, null, rawState);
    }

    private static HealthChangedEvent hpAlive(final int seq, final float raw, final int hp) {
        return new HealthChangedEvent(seq, ts(raw), 7, DecodeConfidence.EXACT, EID,
                hp, null, true, hp, HpRawState.CURRENT_HP);
    }

    private static VehicleHealthStateEvent drowning(final int seq, final float raw, final int hpRaw) {
        return new VehicleHealthStateEvent(seq, ts(raw), 8, DecodeConfidence.EXACT, EID,
                hpRaw, EID, 5, null, HpRawState.CURRENT_HP);
    }

    private static double deathSec(final List<ReplayEvent> events) {
        return ReplayTerminalLifecycle.finalStateByAccount(events, mapping(), 0.0)
                .get(ACC).timeSec();
    }

    @Test
    void duplicateTerminalMirrorsDoNotMoveDeathTime() {
        final List<ReplayEvent> events = List.of(
                hpTerminal(1, 60f, HpRawState.HP_ZERO_TERMINAL),
                hpTerminal(2, 61f, HpRawState.HP_ZERO_TERMINAL));
        assertEquals(60.0, deathSec(events), 1e-9,
                "重复 terminal 镜像不得把死亡时刻向前推（保留首个 terminal 时刻）");
    }

    @Test
    void laterAliveProvesRespawnAndNegatesEarlierTerminal() {
        final List<ReplayEvent> events = List.of(
                hpTerminal(1, 60f, HpRawState.HP_ZERO_TERMINAL),
                hpAlive(2, 70f, 2000));
        assertEquals(70.0, deathSec(events), 1e-9,
                "严格更晚的可信 ALIVE 样本证明重入/复生，并使更早死亡失效");
    }

    @Test
    void positiveHpDrowningIsStillTerminal() {
        final List<ReplayEvent> events = List.of(drowning(1, 80f, 1500));
        final var state = ReplayTerminalLifecycle.finalStateByAccount(events, mapping(), 0.0).get(ACC);
        assertEquals(ReplayTerminalLifecycle.State.TERMINAL, state.state());
        assertEquals(ReplayTerminalLifecycle.TerminalKind.DROWNING, state.terminalKind());
    }

    @Test
    void explicitDrowningOutranksSameClockPositiveHp() {
        final List<ReplayEvent> events = List.of(
                hpAlive(1, 100f, 2000),
                drowning(2, 100f, 1500));
        final var state = ReplayTerminalLifecycle.finalStateByAccount(events, mapping(), 0.0).get(ACC);
        assertEquals(ReplayTerminalLifecycle.State.TERMINAL, state.state());
        assertEquals(ReplayTerminalLifecycle.TerminalKind.DROWNING, state.terminalKind());
    }
}
