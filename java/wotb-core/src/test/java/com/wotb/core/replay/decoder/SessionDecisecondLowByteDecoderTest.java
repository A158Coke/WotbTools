package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.SessionDecisecondLowByteEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Type35 session decisecond counter low-byte decoding (§P1-2). */
class SessionDecisecondLowByteDecoderTest {

    private final SessionDecisecondLowByteDecoder decoder = new SessionDecisecondLowByteDecoder();
    private final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");

    private static RawReplayPacket packet(final byte[] payload) {
        return new RawReplayPacket(0, 0, payload.length, 35, 1.0f,
                PacketReadStatus.NORMAL, payload, 0);
    }

    @Test
    void type35DecodesLowByte() {
        final ReplayDecodeResult r = decoder.decode(ctx, packet(new byte[]{0x2A}));
        assertEquals(DecodeStatus.SUCCESS, r.status());
        final SessionDecisecondLowByteEvent e = (SessionDecisecondLowByteEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertEquals(42, e.low8());
    }

    @Test
    void unknownVersionRawPreservesType35() {
        final ReplayDecodeContext unknown = new ReplayDecodeContext("12.0.0_eu");
        final ReplayDecodeResult r = decoder.decode(unknown, packet(new byte[]{0x2A}));
        assertEquals(DecodeStatus.UNSUPPORTED, r.status());
        assertEquals("VERSION_UNSUPPORTED_TYPE35", ((UnknownReplayEvent) r.events().get(0)).reasonCode());
    }

    @Test
    void layoutMismatchIsNotTreatedAsTruth() {
        // 2-byte payload: not the proven 1-byte layout; must not fabricate a low8 value.
        final ReplayDecodeResult r = decoder.decode(ctx, packet(new byte[]{0x2A, 0x3B}));
        assertEquals(DecodeStatus.UNSUPPORTED, r.status());
        assertEquals("TYPE35_LAYOUT_MISMATCH", ((UnknownReplayEvent) r.events().get(0)).reasonCode());
    }
}
