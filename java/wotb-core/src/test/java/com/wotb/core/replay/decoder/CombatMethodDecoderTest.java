package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.AmmunitionStateEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ProjectileLaunchedEvent;
import com.wotb.core.replay.event.ProjectileTerminalEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.event.TargetingInfoSnapshotEvent;
import com.wotb.core.replay.event.VehicleFiredEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Slice C 解码：method0/17/20/29/36/38 + Type28（C1/C2/C3/C4/C5/C6）。 */
class CombatMethodDecoderTest {

    private final EntityMethodDecoder decoder = new EntityMethodDecoder();
    private final AmmunitionSelectionDecoder type28 = new AmmunitionSelectionDecoder();
    private final ReplayDecodeContext ctx = new ReplayDecodeContext("11.19.0_china");

    private static RawReplayPacket method(final int subType, final byte[] args) {
        // Type8 envelope：entityId(u32) + subtype(u32) + argLen(u32) + args
        final byte[] payload = new byte[12 + args.length];
        ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN).putInt(7);
        payload[4] = (byte) subType;
        ByteBuffer.wrap(payload, 8, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(args.length);
        System.arraycopy(args, 0, payload, 12, args.length);
        return new RawReplayPacket(1, 0, payload.length,
                EntityMethodDecoder.TYPE_ENTITY_METHOD, 10f, payload, 0);
    }

    private static byte[] le32(final int v) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array();
    }

    private static byte[] floats(final float... fs) {
        final ByteBuffer buf = ByteBuffer.allocate(fs.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (final float f : fs) {
            buf.putFloat(f);
        }
        return buf.array();
    }

    @Test
    void method0DecodesVehicleFired() {
        ctx.entityClassRegistry().markVehicle(7);
        final ReplayDecodeResult r = decoder.decode(ctx, method(0, new byte[]{1}));
        final VehicleFiredEvent e = (VehicleFiredEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertEquals(1, e.argRaw());
    }

    @Test
    void method29DecodesLaunchGeometry() {
        ctx.entityClassRegistry().markAvatar(7);
        final byte[] args = concat(le32(100), le32(9001), new byte[]{0},
                floats(1f, 2f, 3f), floats(100f, 0f, 0f), floats(0.5f));
        final ReplayDecodeResult r = decoder.decode(ctx, method(29, args));
        final ProjectileLaunchedEvent e = (ProjectileLaunchedEvent) r.events().get(0);
        assertEquals(100, e.shooterEntityId());
        assertEquals(9001, e.shotId());
        assertEquals(1f, e.launchPosition().x());
        assertEquals(100f, e.launchVelocity().x(), 1e-4f);
    }

    @Test
    void method20DecodesTerminalEndpoint() {
        ctx.entityClassRegistry().markAvatar(7);
        final byte[] args = concat(le32(9001), floats(50f, 10f, 20f));
        final ReplayDecodeResult r = decoder.decode(ctx, method(20, args));
        final ProjectileTerminalEvent e = (ProjectileTerminalEvent) r.events().get(0);
        assertEquals(9001, e.shotId());
        assertEquals(50f, e.terminalPosition().x());
    }

    @Test
    void method38DecodesFullBitfieldWithComponentsAndModifiers() {
        ctx.entityClassRegistry().markAvatar(7);
        // victim + header(hi16=0x0002, low16=0x0210) + count=2 + (36,1)(34,2) + modCount=2 + [1,2]
        final byte[] args = concat(le32(55), le32(0x00020210),
                new byte[]{2, 36, 1, 34, 2, 2, 1, 0, 0, 0, 2, 0, 0, 0});
        final ReplayDecodeResult r = decoder.decode(ctx, method(38, args));
        final ShotResultEvent e = (ShotResultEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertEquals(55, e.victimVehicleId());
        assertEquals(0x0210, e.resultFlags16(), "0x0200 未观测 bit 必须 raw-preserve");
        assertEquals(0x0002, e.headerHi16Raw());
        assertEquals(2, e.components().size());
        assertEquals(ShotResultEvent.ComponentKind.GUN,
                ShotResultEvent.ComponentKind.of(e.components().get(0).token()));
        assertEquals(1, e.components().get(0).state());
        assertEquals(ShotResultEvent.ComponentKind.RIGHT_TRACK,
                ShotResultEvent.ComponentKind.of(e.components().get(1).token()));
        assertEquals(List.of(1, 2), e.modifierIds(), "modifier list additive：Precision Fire + Tungsten 同时");
    }

    @Test
    void method38LengthMismatchIsRawPreserved() {
        ctx.entityClassRegistry().markAvatar(7);
        // PR162：count=5 但只有 0 个 component 字节 → shape 不符 → raw-preserve（UnknownReplayEvent，非 warning-only）
        final byte[] args = concat(le32(55), le32(0), new byte[]{5, 0});
        final ReplayDecodeResult r = decoder.decode(ctx, method(38, args));
        assertTrue(r.events().size() == 1);
        assertTrue(r.events().getFirst() instanceof com.wotb.core.replay.event.UnknownReplayEvent,
                "shape 不符必须 raw-preserve 为 UnknownReplayEvent");
        assertTrue(r.warnings().stream().anyMatch(w -> "UNKNOWN_SUBTYPE_VARIANT".equals(w.code())));
    }

    @Test
    void method36DecodesTargetingScalars() {
        ctx.entityClassRegistry().markAvatar(7);
        // root.field1..5 fixed64 + field6{field1 fixed64}
        final byte[] proto = concat(
                fixed64(1, 0.1), fixed64(2, -0.05), fixed64(3, 0.879154807353631),
                fixed64(4, 0.49951977690547217), fixed64(5, 2.158029879254315),
                delimited(6, fixed64(1, 1.5)));
        final byte[] args = new byte[1 + proto.length];
        args[0] = (byte) proto.length;
        System.arraycopy(proto, 0, args, 1, proto.length);
        final ReplayDecodeResult r = decoder.decode(ctx, method(36, args));
        final TargetingInfoSnapshotEvent e = (TargetingInfoSnapshotEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertEquals(0.1, e.turretYawRad(), 1e-9);
        assertEquals(-0.05, e.gunPitchRad(), 1e-9);
        assertEquals(0.879154807353631, e.maxHorizontalRateRadS(), 1e-9);
        assertEquals(0.49951977690547217, e.maxVerticalRateRadS(), 1e-9);
        assertEquals(2.158029879254315, e.aimingTimeScalarRaw(), 1e-9);
        assertEquals(1.5, e.dispersionBloomRaw(), 1e-9);
    }

    @Test
    void method36InitVariantOmitsDynamicYawAndPitch() {
        ctx.entityClassRegistry().markAvatar(7);
        final byte[] proto = concat(
                fixed64(3, 0.8), fixed64(4, 0.5), fixed64(5, 2.0),
                delimited(6, fixed64(1, 1.0)));
        final byte[] args = new byte[1 + proto.length];
        args[0] = (byte) proto.length;
        System.arraycopy(proto, 0, args, 1, proto.length);
        final ReplayDecodeResult r = decoder.decode(ctx, method(36, args));
        final TargetingInfoSnapshotEvent e = (TargetingInfoSnapshotEvent) r.events().get(0);
        assertNull(e.turretYawRad(), "74-byte init 变体无动态 field1/field2 → null");
        assertNull(e.gunPitchRad());
        assertEquals(0.8, e.maxHorizontalRateRadS(), 1e-9);
    }

    @Test
    void method17DecodesAmmoDescriptorAndQuantity() {
        ctx.entityClassRegistry().markAvatar(7);
        final byte[] args = concat(le32(0x003C5A0A), new byte[]{0, 9, 0, 0, 0, 0, 0, 0});
        final ReplayDecodeResult r = decoder.decode(ctx, method(17, args));
        final AmmunitionStateEvent e = (AmmunitionStateEvent) r.events().get(0);
        assertEquals(0x003C5A0A, e.itemDescriptorRaw());
        assertEquals(9, e.remainingQuantity());
        assertEquals(0, e.flagRaw());
    }

    @Test
    void type28DecodesSelectionValue() {
        final RawReplayPacket packet = new RawReplayPacket(1, 0, 4,
                28, 10f, le32(2), 0);
        final ReplayDecodeResult r = type28.decode(ctx, packet);
        final AmmunitionSelectionChangedEvent e =
                (AmmunitionSelectionChangedEvent) r.events().get(0);
        assertEquals(DecodeConfidence.EXACT, e.confidence());
        assertEquals(2, e.selectionValue());
    }

    @Test
    void type28OutOfDomainIsPartialNotExact() {
        final RawReplayPacket packet = new RawReplayPacket(1, 0, 4,
                28, 10f, le32(9), 0);
        final ReplayDecodeResult r = type28.decode(ctx, packet);
        assertEquals(DecodeStatus.PARTIAL, r.status());
        final AmmunitionSelectionChangedEvent e =
                (AmmunitionSelectionChangedEvent) r.events().get(0);
        assertEquals(DecodeConfidence.PARTIAL, e.confidence());
    }

    private static byte[] fixed64(final int field, final double value) {
        final byte[] tagAndValue = new byte[1 + 8];
        tagAndValue[0] = (byte) ((field << 3) | 1);
        ByteBuffer.wrap(tagAndValue, 1, 8).order(ByteOrder.LITTLE_ENDIAN)
                .putLong(Double.doubleToLongBits(value));
        return tagAndValue;
    }

    private static byte[] delimited(final int field, final byte[] value) {
        final byte[] out = new byte[2 + value.length];
        out[0] = (byte) ((field << 3) | 2);
        out[1] = (byte) value.length;
        System.arraycopy(value, 0, out, 2, value.length);
        return out;
    }

    private static byte[] concat(final byte[]... arrays) {
        int total = 0;
        for (final byte[] a : arrays) {
            total += a.length;
        }
        final byte[] out = new byte[total];
        int off = 0;
        for (final byte[] a : arrays) {
            System.arraycopy(a, 0, out, off, a.length);
            off += a.length;
        }
        return out;
    }
}
