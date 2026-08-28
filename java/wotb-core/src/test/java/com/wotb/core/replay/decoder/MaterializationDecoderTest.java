package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
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
    private final EntityLeaveDecoder leaveDecoder = new EntityLeaveDecoder();
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
        assertEquals(DecodeConfidence.EXACT, e.confidence(),
                "presence EXACT independent of HP class scope");
    }

    @Test
    void futureVersionStructurallyDecodesType5Materialization() {
        // PR162 前向兼容：Type5 materialization 结构是 entity-lifecycle 布局（精确 shape 校验），
        // 未来版本（11.20）用已证明的 53-byte 车辆 shape 仍结构化解出 presence=EXACT；
        // 但 HP 是闭合语义（closedSemanticsAllowed 11.20=false），currentHp 保持 raw/null，
        // 绝不伪造成 HP 值。
        final ReplayDecodeContext unknown = new ReplayDecodeContext("11.20.0_china");
        final ReplayDecodeResult r = decoder.decode(unknown, packet(5, vehicleType5(123, 2, 3570)));
        assertEquals(DecodeStatus.SUCCESS, r.status(),
                "future version structurally decodes materialization presence");
        final MaterializationEvent e = (MaterializationEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence(),
                "presence EXACT independent of HP semantic gate");
        assertEquals(123, e.entityId());
        assertEquals(2, e.entityTypeId());
        assertNull(e.currentHp(), "11.20 HP closed semantics not verified -> HP stays raw/null");
    }

    @Test
    void materializationPresenceExactEvenWhenHpSentinel() {
        // §P0-1: HP sentinel means HP unknown, but materialization presence is still PROVEN (EXACT),
        // so the AoI observed segment must still open.
        final byte[] payload = vehicleType5(123, 2, 0xFFFD); // death sentinel family: not a real HP
        final ReplayDecodeResult r = decoder.decode(ctx, packet(5, payload));
        final MaterializationEvent e = (MaterializationEvent) r.events().get(0);
        assertNull(e.currentHp(), "sentinel HP must stay unknown");
        assertEquals(DecodeConfidence.EXACT, e.confidence(),
                "HP unknown must not downgrade proven materialization presence");
    }

    @Test
    void futureVersionStructurallyDecodesType4AndType33() {
        // PR162 前向兼容：Type4 leave + Type33 announcement 是 entity-lifecycle 结构布局；
        // 未来版本（12.0）用已证明的精确 shape（Type4=4B、Type33=12B all-zero tail）仍结构化解出
        // AoI boundary 证据（EXACT）；闭合语义保持 raw/gated。
        final ReplayDecodeContext unknown = new ReplayDecodeContext("12.0.0_eu");
        final byte[] four = new byte[4];
        four[0] = 9;
        final ReplayDecodeResult r4 = leaveDecoder.decode(unknown, packet(4, four));
        assertEquals(DecodeStatus.SUCCESS, r4.status());
        final EntityRemovedEvent e4 = (EntityRemovedEvent) r4.events().get(0);
        assertEquals(9, e4.entityId());
        assertEquals(DecodeConfidence.EXACT, e4.confidence());

        final byte[] thirtyThree = new byte[12];
        thirtyThree[0] = 42;
        final ReplayDecodeResult r33 = announcedDecoder.decode(unknown, packet(33, thirtyThree));
        assertEquals(DecodeStatus.SUCCESS, r33.status());
        final MaterializationAnnouncedEvent e33 = (MaterializationAnnouncedEvent) r33.events().get(0);
        assertEquals(42, e33.entityId());
        assertEquals(DecodeConfidence.EXACT, e33.confidence());
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

    @Test
    void type33NonExactShapeRawPreserves() {
        // P1: only the exact proven 12-byte shape emits EXACT; 13-byte is raw-preserved (UNKNOWN).
        final byte[] payload = new byte[13];
        payload[0] = 42;
        final ReplayDecodeResult r = announcedDecoder.decode(ctx, packet(33, payload));
        assertEquals(DecodeStatus.PARTIAL, r.status());
        assertEquals("TYPE33_SHAPE_MISMATCH", ((UnknownReplayEvent) r.events().get(0)).reasonCode());
        assertEquals(DecodeConfidence.UNKNOWN, r.events().get(0).confidence());
    }

    @Test
    void type33NonzeroTailRawPreserves() {
        // P1: zeroTail must be all-zero; a nonzero byte is raw-preserved, not upgraded to EXACT.
        final byte[] payload = new byte[12];
        payload[0] = 42;
        payload[11] = 0x01; // nonzero zero-tail byte
        final ReplayDecodeResult r = announcedDecoder.decode(ctx, packet(33, payload));
        assertEquals(DecodeStatus.PARTIAL, r.status());
        assertEquals("TYPE33_ZERO_TAIL_NONZERO", ((UnknownReplayEvent) r.events().get(0)).reasonCode());
    }

    @Test
    void type4NonExactShapeRawPreserves() {
        // P1: Type4 exact proven shape is a single i32 entityId (4 bytes); 5 bytes is raw-preserved.
        final byte[] payload = new byte[5];
        payload[0] = 9;
        final ReplayDecodeResult r = leaveDecoder.decode(ctx, packet(4, payload));
        assertEquals(DecodeStatus.PARTIAL, r.status());
        assertEquals("TYPE4_SHAPE_MISMATCH", ((UnknownReplayEvent) r.events().get(0)).reasonCode());
    }
}
