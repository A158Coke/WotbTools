package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * 占位解码器：对指定 type 的包做最小记录，不做语义解析。
 * <p>
 * 用于第一阶段还未实现完整解码的 packet type（如 5/31/35/39）。
 * 确保完整读取、统计数量、保存类型和时钟。
 * </p>
 */
public class PlaceholderDecoder implements ReplayPacketDecoder {

    private final int targetType;

    public PlaceholderDecoder(int targetType) {
        this.targetType = targetType;
    }

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == targetType;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        final UnknownReplayEvent event = new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(),
                packet.payloadLength(),
                "PLACEHOLDER_TYPE_" + targetType,
                DecodeConfidence.UNKNOWN);

        return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED, List.of(event),
                List.of(new ReplayDecodeWarning("PLACEHOLDER_DECODER",
                        "Packet type " + targetType + " not yet decoded (placeholder)")));
    }
}
