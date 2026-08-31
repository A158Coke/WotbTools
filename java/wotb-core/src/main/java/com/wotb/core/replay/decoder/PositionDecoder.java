package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.AttachedTransformEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/**
 * Type10 49-byte transform decoder.
 *
 * <p>World coordinates and attached/local transforms are deliberately separated: parent != 0 is
 * emitted as {@link AttachedTransformEvent}, so legacy map/movement consumers cannot silently treat
 * child-local (0,0,0) as world origin.</p>
 */
public class PositionDecoder implements ReplayPacketDecoder {

    static final int TYPE_POSITION = 10;
    static final int PAYLOAD_LEN = 49;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        return packet.type() == TYPE_POSITION;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (payload.length != PAYLOAD_LEN) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "TYPE10_LAYOUT_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE10_LAYOUT_MISMATCH",
                            "Type10 expected 49 bytes, got " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final int spaceId = readI32LE(payload, 4);
        final int attachmentParentEntityId = readI32LE(payload, 8);
        final float x = f32(payload, 12);
        final float y = f32(payload, 16);
        final float z = f32(payload, 20);
        final float errX = f32(payload, 24);
        final float errY = f32(payload, 28);
        final float errZ = f32(payload, 32);
        final float yaw = f32(payload, 36);
        final float pitch = f32(payload, 40);
        final float roll = f32(payload, 44);
        final int trailingStateRaw = payload[48] & 0xFF;

        final List<ReplayDecodeWarning> warnings = new ArrayList<>();
        DecodeConfidence confidence = DecodeConfidence.EXACT;
        if (!allFinite(x, y, z, errX, errY, errZ, yaw, pitch, roll)) {
            warnings.add(new ReplayDecodeWarning("TYPE10_NON_FINITE",
                    "Type10 contains NaN/Infinity at entity " + entityId));
            confidence = DecodeConfidence.PARTIAL;
        }
        if (Float.isFinite(x) && Float.isFinite(y) && Float.isFinite(z)
                && (Math.abs(x) > 5000 || Math.abs(z) > 5000 || Math.abs(y) > 200)) {
            warnings.add(new ReplayDecodeWarning("OUT_OF_BOUNDS",
                    "Type10 position out of bounds at entity " + entityId + ": " + x + "," + y + "," + z));
        }

        if (attachmentParentEntityId != 0) {
            final AttachedTransformEvent attached = new AttachedTransformEvent(
                    packet.sequence(), ts, packet.type(), confidence,
                    entityId, spaceId, attachmentParentEntityId,
                    x, y, z, errX, errY, errZ, yaw, pitch, roll, trailingStateRaw);
            return new ReplayDecodeResult(
                    confidence == DecodeConfidence.EXACT ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL,
                    List.of(attached), warnings);
        }

        final PositionChangedEvent world = new PositionChangedEvent(
                packet.sequence(), ts, packet.type(), confidence,
                entityId, spaceId, 0,
                x, y, z, errX, errY, errZ, yaw, pitch, roll, trailingStateRaw);
        return new ReplayDecodeResult(
                confidence == DecodeConfidence.EXACT ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL,
                List.of(world), warnings);
    }

    private static float f32(final byte[] buf, final int i) {
        return Float.intBitsToFloat(readU32LE(buf, i));
    }

    private static boolean allFinite(final float... values) {
        for (final float value : values) {
            if (!Float.isFinite(value)) {
                return false;
            }
        }
        return true;
    }

    private static int readI32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
