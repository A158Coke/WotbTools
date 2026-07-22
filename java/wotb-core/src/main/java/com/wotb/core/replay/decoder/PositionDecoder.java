package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/**
 * Type 10 (Position) 解码器。
 * <p>
 * BigWorld 格式：entityId(i32) + spaceId(i32) + vehicleId(i32)
 * + position(3xf32) + positionError(3xf32) + yaw/pitch/roll(3xf32) + errorFlag(i8) = 49B。
 * 所有数值必须是有限浮点数，拒绝 NaN 和 Infinity。
 * </p>
 */
public class PositionDecoder implements ReplayPacketDecoder {

    static final int TYPE_POSITION = 10;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_POSITION;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 45) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "Position packet too short: " + payload.length + " bytes")));
        }

        final List<ReplayDecodeWarning> warnings = new ArrayList<>();

        final int entityId = readI32LE(payload, 0);
        final int spaceId = readI32LE(payload, 4);
        final int vehicleId = readI32LE(payload, 8);
        final float x = Float.intBitsToFloat(readU32LE(payload, 12));
        final float y = Float.intBitsToFloat(readU32LE(payload, 16));
        final float z = Float.intBitsToFloat(readU32LE(payload, 20));
        // 每个字段各自要求读取到末尾字节，避免越界（readU32LE 读 offset..offset+3）。
        final float errX = payload.length >= 28 ? Float.intBitsToFloat(readU32LE(payload, 24)) : 0f;
        final float errY = payload.length >= 32 ? Float.intBitsToFloat(readU32LE(payload, 28)) : 0f;
        final float errZ = payload.length >= 36 ? Float.intBitsToFloat(readU32LE(payload, 32)) : 0f;
        final float yaw = payload.length >= 40 ? Float.intBitsToFloat(readU32LE(payload, 36)) : 0f;
        final float pitch = payload.length >= 44 ? Float.intBitsToFloat(readU32LE(payload, 40)) : 0f;
        final float roll = payload.length >= 48 ? Float.intBitsToFloat(readU32LE(payload, 44)) : 0f;
        final byte errorFlag = payload.length >= 49 ? payload[48] : 0;

        DecodeConfidence confidence = DecodeConfidence.EXACT;

        // 验证所有浮点数值
        if (isInvalidFloat(x) || isInvalidFloat(y) || isInvalidFloat(z)) {
            warnings.add(new ReplayDecodeWarning("NAN_POSITION",
                    "Position contains NaN/Infinity at entity " + entityId));
            confidence = DecodeConfidence.PARTIAL;
        }
        if (isInvalidFloat(yaw) || isInvalidFloat(pitch) || isInvalidFloat(roll)) {
            warnings.add(new ReplayDecodeWarning("NAN_ROTATION",
                    "Rotation contains NaN/Infinity at entity " + entityId));
            confidence = DecodeConfidence.PARTIAL;
        }
        if (isInvalidFloat(errX) || isInvalidFloat(errY) || isInvalidFloat(errZ)) {
            warnings.add(new ReplayDecodeWarning("NAN_POSITION_ERROR",
                    "Position error contains NaN/Infinity at entity " + entityId));
            confidence = DecodeConfidence.PARTIAL;
        }

        // 明显异常坐标记录 warning 但继续处理
        if (Float.isFinite(x) && (Math.abs(x) > 5000 || Math.abs(z) > 5000 || Math.abs(y) > 200)) {
            warnings.add(new ReplayDecodeWarning("OUT_OF_BOUNDS",
                    "Position out of bounds at entity " + entityId + ": "
                            + x + "," + y + "," + z));
        }

        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        final PositionChangedEvent event = new PositionChangedEvent(
                packet.sequence(), ts, packet.type(), confidence,
                entityId, spaceId, vehicleId,
                x, y, z, errX, errY, errZ, yaw, pitch, roll, errorFlag);

        final DecodeStatus status = confidence == DecodeConfidence.EXACT
                ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL;

        return new ReplayDecodeResult(status, List.of(event), warnings);
    }

    private static boolean isInvalidFloat(float v) {
        return Float.isNaN(v) || Float.isInfinite(v);
    }

    private static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
