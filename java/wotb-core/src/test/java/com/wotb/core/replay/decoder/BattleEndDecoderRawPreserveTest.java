package com.wotb.core.replay.decoder;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayStreamClosedEvent;
import com.wotb.core.replay.feature.BattleStartResolution;
import com.wotb.core.replay.feature.BattleStartResolver;
import com.wotb.core.replay.reconstruction.BattleStateReconstructor;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Type14 (stream-close) regression (P1). PR147: Type14 = packet-stream end/stop marker. It must never
 * fabricate a winner/finishReason, never act as a battle-start clock anchor, and never set battle-state
 * winner or lifecycle FINISHED (that comes from RoundFinishedEvent / settlement).
 */
class BattleEndDecoderRawPreserveTest {

    private final BattleEndDecoder decoder = new BattleEndDecoder();

    private static RawReplayPacket type14(final int seq, final float clock, final int first4) {
        final byte[] payload = new byte[4];
        payload[0] = (byte) (first4 & 0xFF);
        payload[1] = (byte) ((first4 >> 8) & 0xFF);
        payload[2] = (byte) ((first4 >> 16) & 0xFF);
        payload[3] = (byte) ((first4 >> 24) & 0xFF);
        return new RawReplayPacket(seq, 0, payload.length, BattleEndDecoder.TYPE_BATTLE_END,
                clock, PacketReadStatus.NORMAL, payload, 0);
    }

    @Test
    void type14IsStreamCloseOnly() {
        // payload[0..4) == 1 used to be fabricated into winnerTeam; now stream-close containment.
        final ReplayDecodeResult r = decoder.decode(new ReplayDecodeContext("11.19.0_china"),
                type14(1, 120f, 1));
        final ReplayStreamClosedEvent e = assertInstanceOf(ReplayStreamClosedEvent.class, r.events().get(0));
        assertEquals(DecodeConfidence.UNKNOWN, e.confidence(),
                "Type14 payload unproven -> UNKNOWN, never a semantic battle-end");
        assertTrue(r.events().stream().noneMatch(ev -> ev.getClass().getName().contains("BattleEndedEvent")
                        || ev.getClass().getName().contains("RoundFinished")),
                "Type14 must not emit battle-end / winner / finish semantics");
    }

    @Test
    void unknownType14DoesNotChangeWinner() {
        final List<ReplayEvent> events = List.<ReplayEvent>of(
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), type14(1, 120f, 1)).events().get(0),
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), type14(2, 121f, 2)).events().get(0));
        final BattleStateSnapshot snapshot = new BattleStateReconstructor().reconstruct(events).finalSnapshot();
        assertNull(snapshot.winnerTeam(), "Type14 stream-close must not set battle-state winner");
    }

    @Test
    void type14IsNotABattleStartClockAnchor() {
        final Battle battle = new Battle();
        battle.durationS = 90.0;
        final List<ReplayEvent> events = List.<ReplayEvent>of(
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), type14(1, 120f, 1)).events().get(0));
        final BattleStartResolution res = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, res.status(),
                "Type14 is a stream-close marker, NOT a battle-end/finish anchor -> must not estimate a start");
    }
}
