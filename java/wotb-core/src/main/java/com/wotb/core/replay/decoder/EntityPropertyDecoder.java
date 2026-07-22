package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/**
 * Type 7 (EntityProperty) 解码器。
 * <p>
 * 优先研究并解析：当前血量、最大血量、存活状态、其他能可靠识别的车辆属性。
 * 属性 ID 可能随游戏版本变化，必须设计成版本感知。
 * 第一阶段做保守解析，优先确保不产生错误语义。
 * </p>
 *
 * <p>
 * EntityProperty payload 格式（待确认）：
 * entityId(i32) + propertyCount(i32) + 若干个 property block。
 * 每个 property block 的格式和语义需要进一步逆向工程。
 * </p>
 */
public class EntityPropertyDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_PROPERTY = 7;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_PROPERTY;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();

        if (payload.length < 8) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "EntityProperty packet too short: " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        final List<com.wotb.core.replay.event.ReplayEvent> events = new ArrayList<>();
        final List<ReplayDecodeWarning> warnings = new ArrayList<>();

        // 尝试解析属性块
        // 第一阶段保守处理：尝试识别血量相关属性
        // 格式(猜测): entityId(4) + count(4) + {propId(4) + valueBytes(var)} * count
        if (payload.length >= 8) {
            final int count = readI32LE(payload, 4);
            int off = 8;

            for (int i = 0; i < count && off + 4 <= payload.length; i++) {
                final int propId = readI32LE(payload, off);
                off += 4;

                // 根据已知属性 ID 尝试解析（待根据实际样本验证）
                // 常见属性 ID（根据 WoT 社区已知信息，可能不准确）：
                // - health/curHealth: 可能为特定 propId
                // - maxHealth: 可能为特定 propId
                // - isAlive: 可能为特定 propId
                // 这里不做猜测，记录为 unknown
                warnings.add(new ReplayDecodeWarning("UNKNOWN_PROPERTY",
                        "EntityProperty propId=" + propId + " at entity " + entityId
                                + " not yet decoded"));

                // 跳过剩余 payload 的解析
                // 准确解析需要知道每个 propId 对应的值类型和长度
                // 目前无法可靠确定属性长度，故不尝试进一步解析
            }
        }

        // 输出 unknown 事件
        events.add(new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(),
                payload.length, "ENTITY_PROPERTY_NOT_DECODED",
                DecodeConfidence.UNKNOWN));

        return new ReplayDecodeResult(DecodeStatus.PARTIAL, events, warnings);
    }

    private static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }
}
