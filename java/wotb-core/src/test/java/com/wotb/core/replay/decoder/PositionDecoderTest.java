package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Type10 current layout is strict 49B; any other payload length fails closed as MALFORMED. */
class PositionDecoderTest {

    private final PositionDecoder decoder = new PositionDecoder();
    private final ReplayDecodeContext ctx = new ReplayDecodeContext("11.18.0_china_apple");

    private static RawReplayPacket positionPacket(final int payloadLen) {
        final byte[] payload = new byte[payloadLen];
        return new RawReplayPacket(0, 0, payloadLen, 10, 1.0f,
                payload, 0);
    }

    @Test
    void fullLengthIsExact() {
        final ReplayDecodeResult r = decoder.decode(ctx, positionPacket(49));
        assertEquals(DecodeStatus.SUCCESS, r.status());
        final PositionChangedEvent e = assertInstanceOf(PositionChangedEvent.class, r.events().getFirst());
        assertEquals(DecodeConfidence.EXACT, e.confidence());
    }

    @Test
    void readsPayloadFromSharedSourceAtNonZeroOffset() {
        final int payloadOffset = 3;
        final byte[] source = new byte[payloadOffset + 49 + 2];
        final ByteBuffer buffer = ByteBuffer.wrap(source).order(ByteOrder.LITTLE_ENDIAN);
        buffer.putInt(payloadOffset, 1234);
        buffer.putInt(payloadOffset + 4, 56);
        buffer.putInt(payloadOffset + 8, 0);
        buffer.putFloat(payloadOffset + 12, 10.5f);
        buffer.putFloat(payloadOffset + 16, 20.5f);
        buffer.putFloat(payloadOffset + 20, 30.5f);
        source[payloadOffset + 48] = 7;

        final RawReplayPacket packet = new RawReplayPacket(
                0, 0, 49, 10, 1.0f, source, payloadOffset);
        final ReplayDecodeResult r = decoder.decode(ctx, packet);

        final PositionChangedEvent event = assertInstanceOf(PositionChangedEvent.class, r.events().getFirst());
        assertEquals(1234, event.entityId());
        assertEquals(56, event.spaceId());
        assertEquals(10.5f, event.x());
        assertEquals(20.5f, event.y());
        assertEquals(30.5f, event.z());
        assertEquals(7, event.trailingStateRaw());
    }

    @Test
    void truncatedPayloadFailsClosedAsMalformed() {
        for (int len = 45; len <= 48; len++) {
            final ReplayDecodeResult r = decoder.decode(ctx, positionPacket(len));
            assertEquals(DecodeStatus.MALFORMED, r.status(), "len=" + len);
            assertInstanceOf(UnknownReplayEvent.class, r.events().getFirst(), "len=" + len);
            assertTrue(r.warnings().stream().anyMatch(w -> "TYPE10_LAYOUT_MISMATCH".equals(w.code())),
                    "expected TYPE10_LAYOUT_MISMATCH warning at len=" + len);
        }
    }

    @Test
    void tooShortIsMalformed() {
        final ReplayDecodeResult r = decoder.decode(ctx, positionPacket(44));
        assertEquals(DecodeStatus.MALFORMED, r.status());
        assertInstanceOf(UnknownReplayEvent.class, r.events().getFirst());
    }

    /**
     * PR162 forward compatibility: a future client version whose exact 49B transform layout is
     * structurally valid must STILL decode (structural capability, layer B) — never a hard
     * UNKNOWN solely because the version is newer.
     */
    @Test
    void futureVersionDecodesStructuralTransform() {
        for (final String v : new String[]{"11.22.0_china", "11.20.0_china", "12.0.0_eu"}) {
            final ReplayDecodeResult r = decoder.decode(new ReplayDecodeContext(v), positionPacket(49));
            assertEquals(DecodeStatus.SUCCESS, r.status(), "版本 " + v + " 不得拒绝稳定 49B 布局");
            assertInstanceOf(PositionChangedEvent.class, r.events().getFirst(), "版本 " + v);
        }
    }
}
