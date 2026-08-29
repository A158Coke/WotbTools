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
 * 已证明 shape = {@code entityId(u32 LE) + zeroTail(8 字节，当前全零)}，共 <b>12 字节</b>。
 * 仅当 <b>精确</b> 命中该 shape（长度恰为 12 且 zeroTail 全零）才输出 EXACT announcement；
 * 长度不符 / zeroTail 非零 → {@link UnknownReplayEvent}（UNKNOWN）+ raw-preserve，
 * 绝不把未证明的变体升级为 EXACT semantic announcement。</p>
 *
 * <p><b>版本门禁</b>：虽然结构属 container 级，但把它解为「物化预告」并驱动 canonical AoI
 * 仍需当前 canonical + 显式证明的 11.18 legacy
 * （{@link ReplayVersionGate#entityLifecycleLayoutAllowed}）；未知/未来版本 raw-preserve
 * （UNKNOWN + 诊断），不无条件产出 EXACT announcement。</p>
 */
public class MaterializationAnnouncedDecoder implements ReplayPacketDecoder {

    static final int TYPE_MATERIALIZE_ANNOUNCED = 33;

    /** 已证明的 Type33 精确 shape：entityId(4) + zeroTail(8) = 12 字节。 */
    static final int EXACT_PROVEN_LEN = 12;
    static final int ZERO_TAIL_LEN = 8;

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
        // Type33 announcement is version-scoped despite being container-level. Unknown/future
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
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        // only the exact proven shape produces an EXACT announcement.
        if (payload.length != EXACT_PROVEN_LEN) {
            return new ReplayDecodeResult(DecodeStatus.PARTIAL,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                            payload.length, "TYPE33_SHAPE_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE33_SHAPE_MISMATCH",
                            "Type33 len=" + payload.length + " != proven " + EXACT_PROVEN_LEN
                                    + "; raw-preserved")));
        }
        final byte[] zeroTail = new byte[ZERO_TAIL_LEN];
        System.arraycopy(payload, 4, zeroTail, 0, ZERO_TAIL_LEN);
        for (final byte b : zeroTail) {
            if (b != 0) {
                return new ReplayDecodeResult(DecodeStatus.PARTIAL,
                        List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(),
                                payload.length, "TYPE33_ZERO_TAIL_NONZERO", DecodeConfidence.UNKNOWN)),
                        List.of(new ReplayDecodeWarning("TYPE33_ZERO_TAIL_NONZERO",
                                "Type33 zeroTail not all-zero; raw-preserved")));
            }
        }
        final int entityId = readU32LE(payload, 0);
        return ReplayDecodeResult.of(new MaterializationAnnouncedEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                entityId, zeroTail));
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
