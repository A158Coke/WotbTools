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

/**
 * canonical terminal contract tests on the facts layer.
 *
 * <p>{@code ReplayTerminalLifecycle} is the single terminal authority. These tests pin the canonical
 * merge rules: duplicate terminal mirrors never move the death time forward, a strictly later trusted
 * ALIVE sample proves respawn/re-entry and negates an earlier death, drowning is an explicit terminal
 * independent of HP amount, and an explicit non-HP terminal outranks a same-clock positive-HP sample.</p>
 */
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

    /** HealthChangedEvent carrying an explicit rawState (canonical terminal surface). */
    private static HealthChangedEvent hpTerminal(final int seq, final float raw, final HpRawState rawState) {
        return new HealthChangedEvent(seq, ts(raw), 7, DecodeConfidence.EXACT, EID,
                null, null, null, null, rawState);
    }

    private static HealthChangedEvent hpAlive(final int seq, final float raw, final int hp) {
        return new HealthChangedEvent(seq, ts(raw), 7, DecodeConfidence.EXACT, EID,
                hp, null, true, hp, HpRawState.CURRENT_HP);
    }

    private static VehicleHealthStateEvent drowning(final int seq, final float raw, final int hpRaw) {
        // decoder-like production shape: raw causeFlag preserved, semantic cause=null; self-source is
        // the PR147 packet-local drowning relation. The validated cause comes from the field-specific
        // validator (production path), not from a hardcoded semantic Cause on the raw event.
        return new VehicleHealthStateEvent(seq, ts(raw), 8, DecodeConfidence.EXACT, EID,
                hpRaw, EID, 5, null, HpRawState.CURRENT_HP);
    }

    private static double deathSec(final List<ReplayEvent> events) {
        return ReplayTerminalLifecycle.finalStateByAccount(events, mapping(), 0.0)
                .get(ACC).timeSec();
    }

    @Test
    void duplicateTerminalMirrorsDoNotMoveDeathTime() {
        // Two HP_ZERO_TERMINAL mirrors at 60s and 61s: the canonical first-terminal run must stay 60s.
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
        // Drowning is an explicit terminal cause independent of HP amount (control sample: death with
        // positive HP) — must be recognized even when currentHpRaw > 0.
        final List<ReplayEvent> events = List.of(drowning(1, 80f, 1500));
        final var state = ReplayTerminalLifecycle.finalStateByAccount(events, mapping(), 0.0).get(ACC);
        assertEquals(ReplayTerminalLifecycle.State.TERMINAL, state.state());
        assertEquals(ReplayTerminalLifecycle.TerminalKind.DROWNING, state.terminalKind());
    }

    @Test
    void explicitDrowningOutranksSameClockPositiveHp() {
        // Same clock: a positive-HP ALIVE mirror and an explicit drowning terminal must resolve to the
        // explicit terminal (terminal state is independent of HP amount).
        final List<ReplayEvent> events = List.of(
                hpAlive(1, 100f, 2000),
                drowning(2, 100f, 1500));
        final var state = ReplayTerminalLifecycle.finalStateByAccount(events, mapping(), 0.0).get(ACC);
        assertEquals(ReplayTerminalLifecycle.State.TERMINAL, state.state());
        assertEquals(ReplayTerminalLifecycle.TerminalKind.DROWNING, state.terminalKind());
    }
}
