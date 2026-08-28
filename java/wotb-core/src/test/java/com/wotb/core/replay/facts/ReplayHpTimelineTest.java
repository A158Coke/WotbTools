package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.RecorderHealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 统一 HP timeline（B4）：多 surface 合并 + settlement cross-check。 */
class ReplayHpTimelineTest {

    private static PlayerResult player(final long accountId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = 1;
        return p;
    }

    private static TeamEntityMapping mapping() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1001L));
        return TeamEntityMapper.resolve(battle, recon(List.of(
                new ParticipantMappingEvent(1, new ReplayTimestamp(1f, null), 8,
                        DecodeConfidence.EXACT, 10, 1001L))));
    }

    private static ReplayReconstruction recon(final List<ReplayEvent> events) {
        return new ReplayReconstruction(null, null, 100f, 0f,
                List.of(), events, List.of(), null, null, null);
    }

    @Test
    void mergesAllHpSurfaces() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(1f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new HealthChangedEvent(2, new ReplayTimestamp(5f, null), 7,
                DecodeConfidence.EXACT, 10, 3000, null, true));
        events.add(new MaterializationEvent(3, new ReplayTimestamp(8f, null), 5,
                DecodeConfidence.EXACT, 10, 2, 2800, new byte[8], new byte[0]));
        events.add(new RecorderHealthChangedEvent(4, new ReplayTimestamp(9f, null), 8,
                DecodeConfidence.EXACT, 10, 3570, 1));
        events.add(new VehicleHealthStateEvent(5, new ReplayTimestamp(10f, null), 8,
                DecodeConfidence.EXACT, 10, 2700, 20, 0, VehicleHealthStateEvent.Cause.DIRECT));

        final List<HpObservation> timeline =
                ReplayHpTimeline.build(events, mapping(), 0.0);
        assertEquals(4, timeline.size());
        assertEquals(HpObservationKind.CURRENT_HP, timeline.get(0).kind());
        assertEquals(HpObservationKind.MATERIALIZATION_HP, timeline.get(1).kind());
        assertEquals(2800, timeline.get(1).hp());
        assertEquals(HpObservationKind.RECORDER_HP_MIRROR, timeline.get(2).kind());
        assertEquals(3570, timeline.get(2).hp());
        assertEquals(HpObservationKind.METHOD1_HP, timeline.get(3).kind());
        assertEquals(2700, timeline.get(3).hp());
        assertEquals(1001L, timeline.get(0).accountId());
        assertEquals(ReplayFactSource.OBSERVED_EXACT, timeline.get(0).source());
    }

    @Test
    void settlementCrossCheckReconstructsInitialHp() {
        final PlayerResult survivor = player(1001L);
        survivor.damageReceived = 400;
        survivor.raw = Map.of(1, List.of(3200));
        assertEquals(3600, ReplayHpTimeline.settlementInitialHp(survivor),
                "max(signed field1,0)+damageReceived = 3200+400");

        final PlayerResult dead = player(1002L);
        dead.damageReceived = 2600;
        dead.raw = Map.of(1, List.of(-3)); // terminal sentinel → final HP 0
        assertEquals(2600, ReplayHpTimeline.settlementInitialHp(dead));

        final PlayerResult noRaw = player(1003L);
        assertNull(ReplayHpTimeline.settlementInitialHp(noRaw), "无 field1 且无 damageReceived → null");
    }
}
