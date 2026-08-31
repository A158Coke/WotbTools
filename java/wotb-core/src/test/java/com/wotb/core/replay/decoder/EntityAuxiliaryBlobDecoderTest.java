package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.ConsumableLifecycleEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityAuxiliaryBlobEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Type32 generic envelope + consumable-lifecycle semantic routing（P0-2）。 */
class EntityAuxiliaryBlobDecoderTest {

    private final EntityAuxiliaryBlobDecoder decoder = new EntityAuxiliaryBlobDecoder();

    private static RawReplayPacket packet(final byte[] payload) {
        return new RawReplayPacket(0, 0, payload.length, 32, 10.0f, payload, 0);
    }

    /** 构造 {entityId u32 LE}{flag u8}{bodyLength u32 LE}{body}。 */
    private static byte[] envelope(final int entityId, final int flag, final byte[] body) {
        final ByteBuffer b = ByteBuffer.allocate(9 + body.length).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(entityId);
        b.put((byte) flag);
        b.putInt(body.length);
        b.put(body);
        return b.array();
    }

    private static byte[] consumableBody(final int wireCode, final int state, final double clock, final float param) {
        final ByteBuffer b = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN);
        b.put((byte) 0); // body[0] control
        b.put((byte) 0); // body[1] control
        b.put((byte) wireCode); // body[2]
        b.put((byte) state);    // body[3]
        b.putDouble(clock);     // body[4..12)
        b.putFloat(param);      // body[12..16)
        return b.array();
    }

    private ReplayDecodeContext context(final String version, final boolean markVehicle) {
        final EntityClassRegistry reg = new EntityClassRegistry();
        if (markVehicle) {
            reg.markVehicle(7);
        }
        return new ReplayDecodeContext(version, reg);
    }

    @Test
    void validEnvelopeDecodesGenericAndConsumableForVehicleFlag0Len16() {
        final byte[] body = consumableBody(0x0D, 2, 1234.5, 0f); // Repair Kit activation
        final byte[] payload = envelope(7, 0, body);
        final ReplayDecodeResult r = decoder.decode(context("11.19.0_china", true), packet(payload));
        assertEquals(DecodeStatus.SUCCESS, r.status());
        assertEquals(2, r.events().size());

        final EntityAuxiliaryBlobEvent blob = (EntityAuxiliaryBlobEvent) r.events().get(0);
        assertEquals(7, blob.entityId());
        assertEquals(0, blob.flag());
        assertEquals(16, blob.bodyLength());

        final ConsumableLifecycleEvent c = (ConsumableLifecycleEvent) r.events().get(1);
        assertEquals("REPAIR_KIT", c.logicalItemId());
        assertEquals(ConsumableLifecycleEvent.ConsumableLifecycleState.ACTIVATED, c.state());
        assertEquals(1234.5, c.eventClockRaw(), 1e-9);
    }

    @Test
    void flag1ShortFamilyIsNotMisclassifiedAsConsumable() {
        // flag=1, bodyLen=5 (short family): generic envelope only, never consumable
        final byte[] payload = envelope(7, 1, new byte[]{0x01, 0x02, 0x03, 0x04, 0x05});
        final ReplayDecodeResult r = decoder.decode(context("11.19.0_china", true), packet(payload));
        assertEquals(1, r.events().size());
        assertTrue(r.events().get(0) instanceof EntityAuxiliaryBlobEvent);
    }

    @Test
    void staticEntityNotMisclassified() {
        // VEHICLE class only. Static/unknown entity (class OTHER) -> generic envelope only.
        final byte[] body = consumableBody(0x0D, 2, 0, 0f);
        final byte[] payload = envelope(7, 0, body);
        final ReplayDecodeResult r = decoder.decode(context("11.19.0_china", false), packet(payload));
        assertEquals(1, r.events().size());
        assertTrue(r.events().get(0) instanceof EntityAuxiliaryBlobEvent);
    }

    @Test
    void futureVersionKeepsStructurallyProvenSemanticEnvelope() {
        final byte[] body = consumableBody(0x0D, 2, 0, 0f);
        final byte[] payload = envelope(7, 0, body);
        final ReplayDecodeResult r = decoder.decode(context("11.20.0_china", true), packet(payload));
        assertEquals(2, r.events().size());
        assertTrue(r.events().get(0) instanceof EntityAuxiliaryBlobEvent);
        assertTrue(r.events().get(1) instanceof ConsumableLifecycleEvent);
    }

    @Test
    void bodyLengthMismatchFailsClosedWithDiagnostic() {
        // claim bodyLength=16 but only 8 bytes -> mismatch, malformed
        final byte[] payload = envelope(7, 0, new byte[]{1, 2, 3, 4, 5, 6, 7, 8});
        final ByteBuffer b = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(5, 16); // overwrite bodyLength to lie
        final ReplayDecodeResult r = decoder.decode(context("11.19.0_china", true), packet(payload));
        assertEquals(DecodeStatus.MALFORMED, r.status());
        // malformed framing -> raw-preserve as UnknownReplayEvent (no semantic decode)
        assertEquals(1, r.events().size());
        assertTrue(r.events().get(0) instanceof UnknownReplayEvent);
        assertEquals(1, r.warnings().size());
        assertEquals("TYPE32_BODY_LENGTH_MISMATCH", r.warnings().get(0).code());
    }

    @Test
    void teardownStateDecodes() {
        final byte[] body = consumableBody(0x09, 255, 0, 0f); // teardown
        final byte[] payload = envelope(7, 0, body);
        final ReplayDecodeResult r = decoder.decode(context("11.19.0_china", true), packet(payload));
        final ConsumableLifecycleEvent c = (ConsumableLifecycleEvent) r.events().get(1);
        assertEquals(ConsumableLifecycleEvent.ConsumableLifecycleState.TEARDOWN, c.state());
        assertEquals("ADRENALINE", c.logicalItemId());
    }

    @Test
    void unknownWireCodeKeepsNullIdentityAndRawPreserved() {
        final byte[] body = consumableBody(0x77, 2, 0, 0f); // unresolvable wireCode
        final byte[] payload = envelope(7, 0, body);
        final ReplayDecodeResult r = decoder.decode(context("11.19.0_china", true), packet(payload));
        final ConsumableLifecycleEvent c = (ConsumableLifecycleEvent) r.events().get(1);
        assertEquals(null, c.logicalItemId());
        assertEquals(0x77, c.wireCode());
        assertEquals(DecodeConfidence.PARTIAL, c.confidence());
    }
}
