package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.SessionDecisecondLowByteEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 35 (SessionDecisecondLowByte) decoder.
 *
 * <p>PR147 corpus (docs/research/replay): payload = 1 byte, value = rolling low 8 bits of the
 * client/session monotonic decisecond counter (see {@link SessionDecisecondLowByteEvent}).</p>
 *
 * <p><b>Version gate</b>: only the current canonical 11.19 family may decode this as a
 * session decisecond counter low byte; unknown/future versions raw-preserve (UNKNOWN + diagnostic).
 * It must NOT be interpreted as battle time / Unix time.</p>
 */
public class SessionDecisecondLowByteDecoder implements ReplayPacketDecoder {

    static final int TYPE_SESSION_DECISECOND_LOW_BYTE = 35;
    static final int PAYLOAD_LEN = 1;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_SESSION_DECISECOND_LOW_BYTE;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        // only current canonical family carries this proven semantic.
        if (!ReplayProtocolProfile.sessionDecisecondAllowed(context.clientVersion())) {
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            packet.payloadLength(), "VERSION_UNSUPPORTED_TYPE35",
                            DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "Type35 session decisecond low-byte not affirmed: " + context.clientVersion())));
        }
        if (payload.length != PAYLOAD_LEN) {
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            packet.payloadLength(), "TYPE35_LAYOUT_MISMATCH",
                            DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE35_LAYOUT_MISMATCH",
                            "Type35 expected 1-byte payload, got: " + payload.length)));
        }
        final int low8 = payload[0] & 0xFF;
        return ReplayDecodeResult.of(new SessionDecisecondLowByteEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT, low8));
    }
}
