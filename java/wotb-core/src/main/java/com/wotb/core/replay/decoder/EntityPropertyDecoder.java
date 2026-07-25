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

        // 载荷结构（已从 11.18 样本逆向确认，稳定）：
        //   entityId(u32) + propId(u32) + valueLen(u32) + value(valueLen 字节)
        // 至少需要 12 字节的三段头。
        if (payload.length < 12) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "EntityProperty packet too short: " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final int propId = readU32LE(payload, 4);
        final int valueLen = readU32LE(payload, 8);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        final List<ReplayDecodeWarning> warnings = new ArrayList<>();
        if (valueLen < 0 || 12 + valueLen > payload.length) {
            warnings.add(new ReplayDecodeWarning("PROPERTY_VALUE_TRUNCATED",
                    "EntityProperty valueLen=" + valueLen + " exceeds payload " + payload.length
                            + " at entity " + entityId));
        }

        // 结构已知，但 propId → 语义（尤其血量）的映射尚未可靠逆向：
        // 单靠回放样本无法确定 value 的位布局（详见 docs/replay-data.md 的已知限制）。
        // 因此这里只保留结构信息、不臆断血量/存活，避免向上层/AI 提供伪造数据。
        // 可靠的血量/伤害/击杀/存活/死亡时刻请以 battle_results.dat（Battle/PlayerResult）为准。
        final List<com.wotb.core.replay.event.ReplayEvent> events = new ArrayList<>();
        events.add(new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(),
                payload.length, "ENTITY_PROPERTY_prop" + propId + "_len" + valueLen,
                DecodeConfidence.UNKNOWN));

        return new ReplayDecodeResult(DecodeStatus.PARTIAL, events, warnings);
    }

    private static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }
}
