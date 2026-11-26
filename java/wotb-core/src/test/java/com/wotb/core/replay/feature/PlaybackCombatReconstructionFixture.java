package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnsupportedDamageEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.List;
import java.util.Map;

abstract class PlaybackCombatReconstructionFixture {
    protected static final double START = 1000.0;
    protected static final double DURATION = 200.0;

    protected final TeamEntityMapping mapping = new TeamEntityMapping(
            Map.of(
                    1, new TeamEntityIdentity(1, 1001, "A", 1, "T1", 1, DecodeConfidence.EXACT),
                    2, new TeamEntityIdentity(2, 2002, "B", 2, "T2", 2, DecodeConfidence.EXACT),
                    3, new TeamEntityIdentity(3, 3003, "C", 3, "T3", 2, DecodeConfidence.EXACT),
                    4, new TeamEntityIdentity(4, 4004, "D", 4, "T4", 2, DecodeConfidence.EXACT)),
            Map.of(
                    1001L, List.of(1),
                    2002L, List.of(2),
                    3003L, List.of(3),
                    4004L, List.of(4)),
            0, List.of());

    protected static HealthChangedEvent hp(final int seq, final double rawSec, final int entity,
                                         final Integer hp, final Boolean alive, final DecodeConfidence conf) {
        return new HealthChangedEvent(seq, new ReplayTimestamp((float) rawSec, null), 7, conf,
                entity, hp, null, alive);
    }

    protected static DamageEvent dmg(final int seq, final double rawSec, final int attacker,
                                   final int victim, final int rawDamage) {
        return new DamageEvent(seq, new ReplayTimestamp((float) rawSec, null), 8,
                DecodeConfidence.EXACT, attacker, victim, null, null, rawDamage, false);
    }

    protected static UnsupportedDamageEvent unsup(final int seq, final double rawSec,
                                                final int attacker, final int victim) {
        return unsupV(seq, rawSec, attacker, victim, "DAMAGE_METHOD_VARIANT");
    }

    protected static UnsupportedDamageEvent unsupV(final int seq, final double rawSec,
                                                 final int attacker, final int victim,
                                                 final String variant) {
        return new UnsupportedDamageEvent(seq, new ReplayTimestamp((float) rawSec, null), 8,
                DecodeConfidence.PARTIAL, attacker, victim, null, null, variant);
    }

    protected PlaybackCombatReconstruction.Result derive(final List<com.wotb.core.replay.event.ReplayEvent> events) {
        return PlaybackCombatReconstruction.derive(events, mapping, START, DURATION);
    }


}
