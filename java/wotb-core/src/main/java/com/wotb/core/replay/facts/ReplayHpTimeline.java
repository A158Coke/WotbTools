package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
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
import java.util.List;

/**
 * Unified HP timeline. HP observations deliberately preserve terminal-sentinel provenance and do not
 * define death by themselves; terminal/death consumers use {@link ReplayTerminalLifecycle}.
 */
public final class ReplayHpTimeline {

    private ReplayHpTimeline() {
    }

    public static List<HpObservation> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Double startRawClockSec) {
        final List<HpObservation> out = new ArrayList<>();
        if (events == null) {
            return out;
        }
        for (final ReplayEvent event : events) {
            final double t = eventTime(event, startRawClockSec);
            if (!Double.isFinite(t)) {
                continue;
            }
            switch (event) {
                case HealthChangedEvent h -> appendProp3(out, h, mapping, t);
                case MaterializationEvent m -> {
                    if (m.currentHp() != null && m.confidence() == DecodeConfidence.EXACT) {
                        out.add(new HpObservation(m.entityId(), accountOf(mapping, m.entityId()),
                                t, m.currentHp(), HpObservationKind.MATERIALIZATION_HP,
                                ReplayFactSource.OBSERVED_EXACT));
                    }
                }
                case RecorderHealthChangedEvent r -> {
                    if (r.confidence() == DecodeConfidence.EXACT
                            && HealthChangedEvent.isPlausibleHp(r.currentHp())) {
                        out.add(new HpObservation(r.entityId(), accountOf(mapping, r.entityId()), t,
                                r.currentHp(), HpObservationKind.RECORDER_HP_MIRROR,
                                ReplayFactSource.OBSERVED_EXACT));
                    }
                }
                case VehicleHealthStateEvent v -> appendMethod1(out, v, mapping, t);
                default -> {
                    // no HP surface
                }
            }
        }
        out.sort(Comparator.comparingDouble(HpObservation::timeSec)
                .thenComparingInt(HpObservation::entityId));
        return List.copyOf(out);
    }

    private static void appendProp3(
            final List<HpObservation> out,
            final HealthChangedEvent h,
            final TeamEntityMapping mapping,
            final double t) {
        final HpRawState state = h.rawState() == null ? HpRawState.UNKNOWN_OTHER : h.rawState();
        final long account = accountOf(mapping, h.entityId());
        switch (state) {
            case CURRENT_HP -> {
                if (h.confidence() == DecodeConfidence.EXACT
                        && HealthChangedEvent.isPlausibleHp(h.currentHealth())) {
                    out.add(new HpObservation(h.entityId(), account, t, h.currentHealth(),
                            HpObservationKind.CURRENT_HP, ReplayFactSource.OBSERVED_EXACT));
                }
            }
            case HP_ZERO_TERMINAL -> out.add(new HpObservation(h.entityId(), account, t, 0,
                    HpObservationKind.TERMINAL_ZERO, ReplayFactSource.OBSERVED_EXACT));
            case DEATH_TERMINAL_FFFD -> out.add(new HpObservation(h.entityId(), account, t, null,
                    HpObservationKind.TERMINAL_FFFD, ReplayFactSource.OBSERVED_EXACT));
            case UNKNOWN_FFFF, UNKNOWN_OTHER -> {
                if (h.rawCurrentHealth() != null) {
                    out.add(new HpObservation(h.entityId(), account, t, null,
                            HpObservationKind.UNKNOWN_SENTINEL, ReplayFactSource.UNKNOWN));
                } else if (h.confidence() == DecodeConfidence.EXACT && h.currentHealth() != null) {
                    // Backward-compatible synthetic event without raw provenance.
                    final int hp = h.currentHealth();
                    if (HealthChangedEvent.isPlausibleHp(hp)) {
                        out.add(new HpObservation(h.entityId(), account, t, hp,
                                HpObservationKind.CURRENT_HP, ReplayFactSource.OBSERVED_EXACT));
                    } else if (hp == 0) {
                        out.add(new HpObservation(h.entityId(), account, t, 0,
                                HpObservationKind.TERMINAL_ZERO, ReplayFactSource.OBSERVED_EXACT));
                    }
                }
            }
        }
    }

    private static void appendMethod1(
            final List<HpObservation> out,
            final VehicleHealthStateEvent v,
            final TeamEntityMapping mapping,
            final double t) {
        if (v.confidence() != DecodeConfidence.EXACT) {
            return;
        }
        // consume the decoder-classified rawState propagated with the event; never re-classify
        // the raw u16 here (0xFFFE version-scoped by decoder boundary already).
        final HpRawState state = v.rawState() == null ? HpRawState.UNKNOWN_OTHER : v.rawState();
        final long account = accountOf(mapping, v.entityId());
        switch (state) {
            case CURRENT_HP -> out.add(new HpObservation(v.entityId(), account, t,
                    (int) (short) (v.currentHpRaw() & 0xFFFF), HpObservationKind.METHOD1_HP,
                    ReplayFactSource.OBSERVED_EXACT));
            case HP_ZERO_TERMINAL -> out.add(new HpObservation(v.entityId(), account, t, 0,
                    HpObservationKind.TERMINAL_ZERO, ReplayFactSource.OBSERVED_EXACT));
            case DEATH_TERMINAL_FFFD -> out.add(new HpObservation(v.entityId(), account, t, null,
                    HpObservationKind.TERMINAL_FFFD, ReplayFactSource.OBSERVED_EXACT));
            case UNKNOWN_FFFF, UNKNOWN_OTHER -> out.add(new HpObservation(v.entityId(), account, t, null,
                    HpObservationKind.UNKNOWN_SENTINEL, ReplayFactSource.UNKNOWN));
        }
    }

    /** Settlement-derived initial actual HP cross-check only; not an enemy opening-HP authority. */
    public static Integer settlementInitialHp(final PlayerResult player) {
        if (player == null) {
            return null;
        }
        final Integer signedField1 = signedField1(player);
        final int finalHp = signedField1 == null ? 0 : Math.max(signedField1, 0);
        final int damageReceived = Math.max(player.damageReceived, 0);
        if (signedField1 == null && player.damageReceived <= 0) {
            return null;
        }
        return finalHp + damageReceived;
    }

    private static Integer signedField1(final PlayerResult player) {
        final var raw = player.raw;
        if (raw == null) {
            return null;
        }
        final List<Object> values = raw.get(1);
        if (values == null || values.isEmpty()) {
            return null;
        }
        final Object v = values.getFirst();
        if (v instanceof Integer i) {
            return i;
        }
        if (v instanceof Long l) {
            return (int) (long) l;
        }
        return null;
    }

    private static double eventTime(final ReplayEvent e, final Double startRawClockSec) {
        if (e.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        if (startRawClockSec == null || !Double.isFinite(startRawClockSec)) {
            return e.timestamp().rawClockSec();
        }
        return e.timestamp().rawClockSec() - startRawClockSec;
    }

    private static long accountOf(final TeamEntityMapping mapping, final int entityId) {
        if (mapping == null) {
            return 0;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null && identity.accountId() > 0 ? identity.accountId() : 0;
    }
}
