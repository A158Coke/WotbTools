package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 33（EntityMaterializeAnnouncement / pre-materialization）解码器。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-materialization.md）：
 * payload = {@code entityId(u32 LE) + zeroTail(8 字节，当前全零)}。
 * 结构解码版本无关（container 级）；零尾语义未证明，raw 保留。</p>
 */
public class MaterializationAnnouncedDecoder implements ReplayPacketDecoder {

    static final int TYPE_MATERIALIZE_ANNOUNCED = 33;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_MATERIALIZE_ANNOUNCED;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 4) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "Type33 packet too short: " + payload.length)));
        }
        final int entityId = readU32LE(payload, 0);
        final byte[] zeroTail = new byte[payload.length - 4];
        System.arraycopy(payload, 4, zeroTail, 0, zeroTail.length);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        return ReplayDecodeResult.of(new MaterializationAnnouncedEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                entityId, zeroTail));
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
