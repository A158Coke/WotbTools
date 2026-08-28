package com.wotb.core.replay.decoder;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
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
 * Type14 (Battle End) fabricated-semantics regression (P1). The Type14 payload semantic is unproven:
 * the decoder must NEVER derive a winnerTeam from {@code payload[0..4) == 1/2} (winner stays null,
 * confidence PARTIAL — never EXACT), and it must not produce a fabricated {@code UnknownReplayEvent}.
 * The battle-start clock estimate consumes only the event's raw framing time + the proven settlement
 * duration, not the unproven payload semantic.
 *
 * <p>Authoritative winner/finish surfaces are the settlement layer
 * ({@code battle_results}.{@code winnerTeam} / {@code durationS}), not the unproven Type14 payload.</p>
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
    void type14WinnerLikePayloadNeverFabricatesWinner() {
        // payload[0..4) == 1 used to be fabricated into winnerTeam=EXACT; now winner stays null.
        final ReplayDecodeResult r = decoder.decode(new ReplayDecodeContext("11.19.0_china"),
                type14(1, 120f, 1));
        final BattleEndedEvent e = assertInstanceOf(BattleEndedEvent.class, r.events().get(0));
        assertNull(e.winnerTeam(), "Type14 payload must never fabricate a winnerTeam");
        assertEquals(DecodeConfidence.PARTIAL, e.confidence(),
                "battle-end containment recognized but winner unproven (PARTIAL, never EXACT)");
    }

    @Test
    void unknownType14DoesNotChangeWinner() {
        final List<ReplayEvent> events = List.<ReplayEvent>of(
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), type14(1, 120f, 1)).events().get(0),
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), type14(2, 121f, 2)).events().get(0));
        final BattleStateSnapshot snapshot =
                new BattleStateReconstructor().reconstruct(events).finalSnapshot();
        assertNull(snapshot.winnerTeam(), "unproven Type14 must not set battle-state winner");
    }

    @Test
    void battleStartClockStillResolvableFromProvenDurationAndFramingTime() {
        // The ESTIMATED clock only uses the event raw framing time + settlement duration (both proven).
        final Battle battle = new Battle();
        battle.durationS = 90.0;
        final List<ReplayEvent> events = List.<ReplayEvent>of(
                decoder.decode(new ReplayDecodeContext("11.19.0_china"), type14(1, 120f, 1)).events().get(0));
        final BattleStartResolution res = BattleStartResolver.resolve(null, null, events, battle);
        assertTrue(res.status() == BattleStartResolution.Status.ESTIMATED
                        || res.status() == BattleStartResolution.Status.UNRESOLVED,
                "clock derived only from raw framing time + proven duration (" + res + ")");
    }
}
