package com.wotb.core.replay.facts;

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

/**
 * Canonical live lifecycle for alive/terminal facts.
 *
 * <p>PR147 production rule: HP timeline and terminal/death state are independent facts. Positive HP
 * therefore cannot erase a same-clock terminal (controlled drowning keeps positive HP). A strictly
 * later trusted positive/rematerialization sample can still prove re-entry/respawn and negate an earlier death.</p>
 */
public final class ReplayTerminalLifecycle {

    public enum State {
        ALIVE,
        TERMINAL
    }

    public enum TerminalKind {
        HP_ZERO,
        DEATH_SENTINEL_FFFD,
        VERIFIED_TERMINAL_FFFE,
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

        /** Drowning is an explicit non-projectile terminal cause; do not infer a killer from nearby damage. */
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
                if (v.cause() == VehicleHealthStateEvent.Cause.DROWNING) {
                    state = State.TERMINAL;
                    kind = TerminalKind.DROWNING;
                } else {
                    final HpRawState rawState = HpRawState.classify(v.currentHpRaw(), true);
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
                .thenComparingInt(e -> e.state() == State.TERMINAL ? 1 : 0)
                .thenComparingInt(Evidence::sequence));
        return List.copyOf(out);
    }

    /** Final live state per account. Same-clock terminal outranks positive HP; later clock always wins. */
    public static Map<Long, Evidence> finalStateByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        final Map<Long, Evidence> finalState = new HashMap<>();
        for (final Evidence evidence : build(events, mapping, startRawClockSec)) {
            finalState.merge(evidence.accountId(), evidence, ReplayTerminalLifecycle::later);
        }
        return Map.copyOf(finalState);
    }

    private static Evidence later(final Evidence a, final Evidence b) {
        final double delta = a.timeSec() - b.timeSec();
        if (Math.abs(delta) > 1e-6) {
            return delta > 0 ? a : b;
        }
        if (a.state() != b.state()) {
            return a.state() == State.TERMINAL ? a : b;
        }
        return a.sequence() >= b.sequence() ? a : b;
    }

    private static TerminalKind terminalKind(final HpRawState state) {
        return switch (state) {
            case HP_ZERO_TERMINAL -> TerminalKind.HP_ZERO;
            case DEATH_TERMINAL_FFFD -> TerminalKind.DEATH_SENTINEL_FFFD;
            case VERIFIED_TERMINAL_FFFE -> TerminalKind.VERIFIED_TERMINAL_FFFE;
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
