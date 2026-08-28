package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 28（recorder ammunition selection state）解码器。
 *
 * <p>当前 11.19 corpus（docs/research/replay/type28-ammunition-slot.md）：
 * payload = {@code selectionValue(u32 LE)}，观测域 {0,1,2}。
 * 语义为 recorder-local 弹药选择；选择值 → 弹种必须经 method17 descriptor /
 * version-matched catalog 闭合，不得全局 hardcode。</p>
 */
public class AmmunitionSelectionDecoder implements ReplayPacketDecoder {

    static final int TYPE_AMMUNITION_SELECTION = 28;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_AMMUNITION_SELECTION;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 4) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "Type28 packet too short: " + payload.length)));
        }
        final int selectionValue = readU32LE(payload, 0);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (selectionValue <= 2) {
            return ReplayDecodeResult.of(new AmmunitionSelectionChangedEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                    selectionValue));
        }
        // 域外值未观测：保留 raw，不臆测
        return new ReplayDecodeResult(DecodeStatus.PARTIAL,
                List.of(new AmmunitionSelectionChangedEvent(
                        packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL,
                        selectionValue)),
                List.of(new ReplayDecodeWarning("SELECTION_VALUE_OUT_OF_DOMAIN",
                        "Type28 selectionValue=" + selectionValue
                                + " outside observed domain {0,1,2}")));
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
