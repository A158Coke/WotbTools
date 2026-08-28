package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/** Type28 recorder ammunition-selection state, PR147 current 11.19 profile only. */
public class AmmunitionSelectionDecoder implements ReplayPacketDecoder {

    static final int TYPE_AMMUNITION_SELECTION = 28;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        return packet.type() == TYPE_AMMUNITION_SELECTION;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (!ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "VERSION_UNSUPPORTED_TYPE28", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "Type28 ammunition-selection semantics not affirmed for client version: "
                                    + context.clientVersion())));
        }
        if (payload.length != 4) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "TYPE28_LAYOUT_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE28_LAYOUT_MISMATCH",
                            "Type28 expected 4 bytes, got " + payload.length)));
        }
        final int selectionValue = readU32LE(payload, 0);
        if (selectionValue <= 2) {
            return ReplayDecodeResult.of(new AmmunitionSelectionChangedEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT, selectionValue));
        }
        return new ReplayDecodeResult(DecodeStatus.PARTIAL,
                List.of(new AmmunitionSelectionChangedEvent(
                        packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL, selectionValue)),
                List.of(new ReplayDecodeWarning("SELECTION_VALUE_OUT_OF_DOMAIN",
                        "Type28 selectionValue=" + selectionValue + " outside observed domain {0,1,2}")));
    }

    static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
