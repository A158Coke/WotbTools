package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 33（EntityMaterializeAnnouncement / pre-materialization）解码器。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-materialization.md）：
 * payload = {@code entityId(u32 LE) + zeroTail(8 字节，当前全零)}。
 * 零尾语义未证明，raw 保留。</p>
 *
 * <p><b>版本门禁（§P0-2）</b>：虽然结构属 container 级，但把它解为「物化预告」并驱动 canonical AoI
 * 仍需当前 canonical + 显式证明的 11.18 legacy
 * （{@link ReplayVersionGate#entityLifecycleLayoutAllowed}）；未知/未来版本 raw-preserve
 * （UNKNOWN + 诊断），不无条件产出 EXACT announcement。</p>
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
        // §P0-2: Type33 announcement is version-scoped despite being container-level. Unknown/future
        // versions must raw-preserve; never unconditionally decode into an EXACT announcement.
        if (!ReplayVersionGate.entityLifecycleLayoutAllowed(context.clientVersion())) {
            final ReplayTimestamp tsUnsupported = new ReplayTimestamp(packet.rawClockSec(), null);
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), tsUnsupported, packet.type(),
                            packet.payloadLength(), "VERSION_UNSUPPORTED_TYPE33",
                            DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "Type33 announcement layout not affirmed: " + context.clientVersion())));
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
