package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 4 (EntityLeave) 解码器。
 * <p>
 * payload 结构：entityId(i32 LE)。
 * EntityLeave 不一定代表阵亡，只能表示实体离开或停止存在。
 * </p>
 */
public class EntityLeaveDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_LEAVE = 4;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_LEAVE;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 4) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "EntityLeave packet too short: " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        final EntityRemovedEvent event = new EntityRemovedEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT, entityId);

        return ReplayDecodeResult.of(event);
    }

    private static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }
}
