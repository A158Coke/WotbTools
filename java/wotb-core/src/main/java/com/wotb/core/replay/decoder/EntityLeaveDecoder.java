package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 4 (EntityLeave) 解码器。
 * <p>
 * payload 结构：entityId(i32 LE)。
 * EntityLeave 不一定代表阵亡，只能表示实体离开或停止存在。
 * </p>
 *
 * <p><b>版本门禁（§P0-2）</b>：仅当前 canonical + 显式证明的 11.18 legacy
 * （{@link ReplayVersionGate#entityLifecycleLayoutAllowed}）把 type=4 解为 leave；未知/未来版本
 * raw-preserve（UNKNOWN + 诊断），不向 canonical AoI 输出 EXACT leave。</p>
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

        // §P0-2: Type4 leave semantics are version-scoped. Unknown/future versions must raw-preserve.
        if (!ReplayVersionGate.entityLifecycleLayoutAllowed(context.clientVersion())) {
            final ReplayTimestamp tsUnsupported = new ReplayTimestamp(packet.rawClockSec(), null);
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), tsUnsupported, packet.type(),
                            packet.payloadLength(), "VERSION_UNSUPPORTED_TYPE4",
                            DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "Type4 leave layout not affirmed: " + context.clientVersion())));
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
