package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.RecorderHealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ReplayTerminalLifecycle {

    private static final double SAME_CLOCK_EPSILON = 1e-6;

    public enum State {
        ALIVE,
        TERMINAL
    }

    public enum TerminalKind {
        HP_ZERO,
        DEATH_SENTINEL_FFFD,
        DROWNING,
        LEGACY_EXACT_ALIVE_FALSE
    }

    public record Evidence(
            long accountId,
            int entityId,
            double timeSec,
            int sequence,
            State state,
            TerminalKind terminalKind
    ) {
        public boolean terminal() {
            return state == State.TERMINAL;
        }

        public boolean allowsDamageKillerAttribution() {
            return terminal() && terminalKind != TerminalKind.DROWNING;
        }
    }

    private ReplayTerminalLifecycle() {
    }

    public static List<Evidence> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        return build(events, mapping, startRawClockSec, null);
    }

    public static List<Evidence> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec,
            final Battle battle) {
        if (events == null || mapping == null) {
            return List.of();
        }
        final List<Evidence> out = new ArrayList<>();
        for (final ReplayEvent event : events) {
            if (event == null || event.confidence() != DecodeConfidence.EXACT) {
                continue;
            }
            final int entityId;
            final State state;
            final TerminalKind kind;
            if (event instanceof HealthChangedEvent h) {
                entityId = h.entityId();
                final HpRawState rawState = h.rawState();
                if (rawState != null && rawState.terminal()) {
                    state = State.TERMINAL;
                    kind = terminalKind(rawState);
                } else if (Boolean.FALSE.equals(h.alive())) {
                    state = State.TERMINAL;
                    kind = TerminalKind.LEGACY_EXACT_ALIVE_FALSE;
                } else if (Boolean.TRUE.equals(h.alive()) && h.currentHealth() != null
                        && HealthChangedEvent.isPlausibleHp(h.currentHealth())) {
                    state = State.ALIVE;
                    kind = null;
                } else {
                    continue;
                }
            } else if (event instanceof VehicleHealthStateEvent v) {
                entityId = v.entityId();
                final VehicleHealthStateEvent.Cause validatedCause = v.cause() != null
                        ? v.cause() : VehicleHealthCauseValidator.validate(v, battle, mapping);
                if (validatedCause == VehicleHealthStateEvent.Cause.DROWNING) {
                    state = State.TERMINAL;
                    kind = TerminalKind.DROWNING;
                } else {
                    final HpRawState rawState = v.rawState() == null ? HpRawState.UNKNOWN_OTHER : v.rawState();
                    if (!rawState.terminal()) {
                        continue;
                    }
                    state = State.TERMINAL;
                    kind = terminalKind(rawState);
                }
            } else if (event instanceof MaterializationEvent m) {
                if (m.currentHp() == null || !HealthChangedEvent.isPlausibleHp(m.currentHp())) {
                    continue;
                }
                entityId = m.entityId();
                state = State.ALIVE;
                kind = null;
            } else if (event instanceof RecorderHealthChangedEvent r) {
                if (!HealthChangedEvent.isPlausibleHp(r.currentHp())) {
                    continue;
                }
                entityId = r.entityId();
                state = State.ALIVE;
                kind = null;
            } else {
                continue;
            }

            final TeamEntityIdentity identity = mapping.identity(entityId);
            if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                continue;
            }
            final double time = eventTime(event, startRawClockSec);
            if (!Double.isFinite(time) || time <= 0) {
                continue;
            }
            out.add(new Evidence(identity.accountId(), entityId, time,
                    event.sequence(), state, kind));
        }
        out.sort(Comparator.comparingDouble(Evidence::timeSec)
                .thenComparingInt(Evidence::sequence));
        return List.copyOf(out);
    }

    public static Map<Long, Evidence> finalStateByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        return finalStateByAccount(events, mapping, startRawClockSec, null);
    }

    public static Map<Long, Evidence> finalStateByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec,
            final Battle battle) {
        final Map<Long, Evidence> finalState = new HashMap<>();
        for (final Evidence evidence : build(events, mapping, startRawClockSec, battle)) {
            finalState.merge(evidence.accountId(), evidence, ReplayTerminalLifecycle::later);
        }
        return Map.copyOf(finalState);
    }

    private static Evidence later(final Evidence current, final Evidence incoming) {
        final double delta = incoming.timeSec() - current.timeSec();
        if (delta > SAME_CLOCK_EPSILON) {
            if (current.terminal() && incoming.terminal()) {
                return current;
            }
            return incoming;
        }
        if (delta < -SAME_CLOCK_EPSILON) {
            return current;
        }

        if (current.state() == incoming.state()) {
            return incoming.sequence() >= current.sequence() ? incoming : current;
        }

        final Evidence terminal = current.terminal() ? current : incoming;
        if (isExplicitTerminalIndependentOfHp(terminal)) {
            return terminal;
        }
        return incoming.sequence() >= current.sequence() ? incoming : current;
    }

    private static boolean isExplicitTerminalIndependentOfHp(final Evidence evidence) {
        return evidence.terminalKind() == TerminalKind.DROWNING
                || evidence.terminalKind() == TerminalKind.DEATH_SENTINEL_FFFD;
    }

    private static TerminalKind terminalKind(final HpRawState state) {
        return switch (state) {
            case HP_ZERO_TERMINAL -> TerminalKind.HP_ZERO;
            case DEATH_TERMINAL_FFFD, DEATH_TERMINAL -> TerminalKind.DEATH_SENTINEL_FFFD;
            default -> TerminalKind.LEGACY_EXACT_ALIVE_FALSE;
        };
    }

    private static double eventTime(final ReplayEvent event, final Double startRawClockSec) {
        if (event.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        if (startRawClockSec == null || !Double.isFinite(startRawClockSec)) {
            return event.timestamp().rawClockSec();
        }
        return event.timestamp().rawClockSec() - startRawClockSec;
    }
}
