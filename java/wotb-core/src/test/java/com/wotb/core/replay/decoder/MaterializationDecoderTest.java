package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.stream.PacketReadStatus;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** Type5 物化 + Type33 预物化解码（B8/AoI 与 B4 Type5 HP 快照）。 */
class MaterializationDecoderTest {

    private final MaterializationDecoder decoder = new MaterializationDecoder();
    private final MaterializationAnnouncedDecoder announcedDecoder = new MaterializationAnnouncedDecoder();
    private final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");

    private static RawReplayPacket packet(final int type, final byte[] payload) {
        return new RawReplayPacket(0, 0, payload.length, type, 1.0f,
                PacketReadStatus.NORMAL, payload, 0);
    }

    private static byte[] vehicleType5(final int entityId, final int entityTypeId, final int hp) {
        final byte[] payload = new byte[53];
        final ByteBuffer buf = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN);
        buf.putInt(entityId);
        buf.putShort((short) entityTypeId);
        buf.position(MaterializationDecoder.HP_OFFSET); // 51
        buf.putShort((short) hp); // offset 51..53 = current HP snapshot
        return payload;
    }

    @Test
    void combatVehicleType5DecodesHpSnapshot() {
        final byte[] payload = vehicleType5(123, 2, 3570);
        final ReplayDecodeResult r = decoder.decode(ctx, packet(5, payload));
        assertEquals(DecodeStatus.SUCCESS, r.status());
        final MaterializationEvent e = (MaterializationEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertEquals(123, e.entityId());
        assertEquals(2, e.entityTypeId());
        assertEquals(3570, e.currentHp());
    }

    @Test
    void nonVehicleEntityTypeDoesNotExposeHp() {
        final byte[] payload = vehicleType5(123, 3, 3570); // static family: no HP semantics
        final ReplayDecodeResult r = decoder.decode(ctx, packet(5, payload));
        final MaterializationEvent e = (MaterializationEvent) r.events().get(0);
        assertNull(e.currentHp(), "non-entityTypeId=2 must not expose HP (version/class scoped)");
        assertEquals(DecodeConfidence.PARTIAL, e.confidence());
    }

    @Test
    void hpOffsetIsVersionGated() {
        // 未知版本：raw-preserve，不得按 11.19 偏移 51 臆测 HP
        final ReplayDecodeContext unknown = new ReplayDecodeContext("11.20.0_china");
        final ReplayDecodeResult r = decoder.decode(unknown, packet(5, vehicleType5(123, 2, 3570)));
        final MaterializationEvent e = (MaterializationEvent) r.events().get(0);
        assertNull(e.currentHp(), "unknown version must not apply offset-51 semantics");
    }

    @Test
    void hpSentinelStaysUnknownNotExact() {
        final byte[] payload = vehicleType5(123, 2, 0xFFFD); // death sentinel family: not a real HP
        final ReplayDecodeResult r = decoder.decode(ctx, packet(5, payload));
        final MaterializationEvent e = (MaterializationEvent) r.events().get(0);
        assertNull(e.currentHp());
        assertEquals(DecodeConfidence.PARTIAL, e.confidence());
    }

    @Test
    void type33DecodesEntityAndPreservesTail() {
        final byte[] payload = new byte[12];
        payload[0] = 42;
        final ReplayDecodeResult r = announcedDecoder.decode(ctx, packet(33, payload));
        assertEquals(DecodeStatus.SUCCESS, r.status());
        final MaterializationAnnouncedEvent e = (MaterializationAnnouncedEvent) r.events().get(0);
        assertEquals(42, e.entityId());
        assertEquals(8, e.zeroTail().length);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
    }
}
