package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import java.util.ArrayList;
import java.util.List;

abstract class RelativeDepthHpEvidenceTestSupport {
    static final String MAP = "holland";
    static final long E100 = 9489L;
    static final long FV215B183 = 9297L;
    static final long VICKERS_LIGHT = 19537L;

    static PlayerResult player(final long accountId, final int team, final long tankId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.entryHpSource = EntryHpSource.OBSERVED_EXACT;
        p.entryHp = 2000;
        p.observedMaxHp = 2000;
        p.survived = true;
        return p;
    }

    static PositionChangedEvent pos(final int sequence, final float rawClock,
                                            final int entityId, final float x, final float z) {
        return new PositionChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0, x, 0f, z,
                0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    static HealthChangedEvent hp(final int sequence, final float rawClock,
                                         final int entityId, final int currentHealth) {
        return new HealthChangedEvent(sequence, new ReplayTimestamp(rawClock, null), 7,
                DecodeConfidence.EXACT, entityId, currentHealth, null, true);
    }

    static DamageEvent dmg(final int sequence, final float rawClock,
                                   final int attackerEid, final int victimEid) {
        return new DamageEvent(sequence, new ReplayTimestamp(rawClock, null), 8,
                DecodeConfidence.EXACT, attackerEid, victimEid, null, null, 200, false);
    }

    static ReplayReconstruction recon(final boolean withHp, final boolean withDamage) {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(11, 42f, 10, -210f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(13, 42f, 11, -80f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(pos(22, 64f, 20, 200f, 0f));
        events.add(pos(23, 64f, 21, 230f, 50f));
        events.add(pos(24, 120f, 20, 200f, 0f));
        events.add(pos(25, 120f, 21, 230f, 50f));
        if (withHp) {
            events.add(hp(30, 30f, 10, 1800));
            events.add(hp(31, 30f, 11, 1000));
        }
        if (withDamage) {
            events.add(dmg(40, 50f, 10, 20));
            events.add(dmg(41, 60f, 10, 21));
        }
        return new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
    }

    static Battle battle(final long ally1Tank, final long ally2Tank) {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, ally1Tank),
                player(1002L, 1, ally2Tank),
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        return battle;
    }
}
