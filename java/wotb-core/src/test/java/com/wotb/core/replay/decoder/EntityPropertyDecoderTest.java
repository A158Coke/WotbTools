package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

class EntityPropertyDecoderTest {

    private final EntityPropertyDecoder decoder = new EntityPropertyDecoder();
    private final ReplayDecodeContext context = new ReplayDecodeContext("test");

    private static RawReplayPacket packet(final int propId, final byte[] value) {
        final byte[] payload = new byte[12 + value.length];
        putU32(payload, 0, 12_345);
        putU32(payload, 4, propId);
        putU32(payload, 8, value.length);
        System.arraycopy(value, 0, payload, 12, value.length);
        return new RawReplayPacket(
                1, 0, payload.length, EntityPropertyDecoder.TYPE_ENTITY_PROPERTY,
                10.0f, PacketReadStatus.NORMAL, payload, 0);
    }

    @Test
    void propId3DecodesCurrentHpAsLeU16() {
        // value = 0x0b96 (LE) = 2966
        final byte[] value = {(byte) 0x96, 0x0b};
        final ReplayDecodeResult result = decoder.decode(context, packet(3, value));
        assertEquals(DecodeStatus.SUCCESS, result.status());
        final HealthChangedEvent event = assertInstanceOf(
                HealthChangedEvent.class, result.events().getFirst());
        assertEquals(12_345, event.entityId());
        assertEquals(2966, event.currentHealth());
        assertEquals(Boolean.TRUE, event.alive());
        assertEquals(DecodeConfidence.EXACT, event.confidence());
    }

    @Test
    void propId3ZeroMeansDestroyed() {
        final byte[] value = {0x00, 0x00};
        final ReplayDecodeResult result = decoder.decode(context, packet(3, value));
        final HealthChangedEvent event = assertInstanceOf(
                HealthChangedEvent.class, result.events().getFirst());
        assertEquals(0, event.currentHealth());
        assertEquals(Boolean.FALSE, event.alive());
    }

    @Test
    void unknownPropIdStaysUnknownEvent() {
        final byte[] value = {(byte) 0xff, (byte) 0xff};
        final ReplayDecodeResult result = decoder.decode(context, packet(2, value));
        assertEquals(DecodeStatus.PARTIAL, result.status());
        assertInstanceOf(UnknownReplayEvent.class, result.events().getFirst());
    }

    private static void putU32(final byte[] buf, final int i, final int v) {
        buf[i] = (byte) v;
        buf[i + 1] = (byte) (v >>> 8);
        buf[i + 2] = (byte) (v >>> 16);
        buf[i + 3] = (byte) (v >>> 24);
    }
}
