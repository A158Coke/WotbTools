package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.AimRayStateEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/** Type39 recorder aim/camera geometry (PR147 current 11.19 profile). */
public final class AimRayStateDecoder implements ReplayPacketDecoder {

    static final int TYPE_AIM_RAY_STATE = 39;
    static final int PAYLOAD_LEN = 7 * Float.BYTES;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        return packet.type() == TYPE_AIM_RAY_STATE;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (!ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            packet.payloadLength(), "VERSION_UNSUPPORTED_TYPE39", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "Type39 semantics not affirmed for client version: " + context.clientVersion())));
        }
        final byte[] payload = packet.payload();
        if (payload.length != PAYLOAD_LEN) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            payload.length, "TYPE39_LAYOUT_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE39_LAYOUT_MISMATCH",
                            "Type39 expected 28 bytes, got " + payload.length)));
        }
        final float[] f = new float[7];
        for (int i = 0; i < f.length; i++) {
            f[i] = Float.intBitsToFloat(readU32LE(payload, i * Float.BYTES));
            if (!Float.isFinite(f[i])) {
                return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                        List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                                payload.length, "TYPE39_NON_FINITE", DecodeConfidence.UNKNOWN)),
                        List.of(new ReplayDecodeWarning("TYPE39_NON_FINITE",
                                "Type39 contains non-finite float at index " + i)));
            }
        }
        return ReplayDecodeResult.of(new AimRayStateEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                f[0], f[1], f[2], f[3], f[4], f[5], f[6]));
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
