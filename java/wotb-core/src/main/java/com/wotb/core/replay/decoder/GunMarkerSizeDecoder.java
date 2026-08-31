package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.GunMarkerSizeEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/** Type31 recorder arcade gun-marker size; valid four-byte framing is decoded independently of version text. */
public final class GunMarkerSizeDecoder implements ReplayPacketDecoder {

    static final int TYPE_GUN_MARKER_SIZE = 31;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        return packet.type() == TYPE_GUN_MARKER_SIZE;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        final byte[] payload = packet.payload();
        if (payload.length != Float.BYTES) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            payload.length, "TYPE31_LAYOUT_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE31_LAYOUT_MISMATCH",
                            "Type31 expected 4 bytes, got " + payload.length)));
        }
        final float value = Float.intBitsToFloat(readU32LE(payload, 0));
        if (!Float.isFinite(value)) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            payload.length, "TYPE31_NON_FINITE", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE31_NON_FINITE", "Type31 marker size is non-finite")));
        }
        return ReplayDecodeResult.of(new GunMarkerSizeEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT, value));
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
