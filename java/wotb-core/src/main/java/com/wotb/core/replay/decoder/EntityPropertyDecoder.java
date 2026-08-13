package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
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
 *
 * <p>已逆向（2026-08-09，4 个训练房样本交叉验证）：payload = entityId(u32) +
 * propId(u32) + valueLen(u32) + value；propId=3 的 value 为当前血量（u16 LE，
 * 含装备加成；受击时同步、阵亡到 0、存活不到 0）。其它 propId 语义未确认，
 * 仍输出 UnknownReplayEvent。</p>
 */
public class EntityPropertyDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_PROPERTY = 7;
    /** propId=3：当前血量（u16 LE，含装备加成；受击时同步）。 */
    static final int PROP_CURRENT_HP = 3;
    /**
     * propId=2：炮塔相对车体偏航（valueLen=2 u16 LE；度 = raw*360/65536 - 180，[-180,180)）。
     * 2026-08-13 旋转实验证明：车体静止炮塔转一圈 prop2 恰好扫过 360° 且带 wrap；
     * 开火锚点拟合证明：炮口世界方向 = normalize(hullYaw + prop2)（交叉验证残差 2.3°）。
     */
    static final int PROP_TURRET_RELATIVE_YAW = 2;
    static final double TURRET_YAW_SCALE_DEG = 360.0 / 65536.0;
    static final double TURRET_YAW_OFFSET_DEG = -180.0;

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

        final List<com.wotb.core.replay.event.ReplayEvent> events = new ArrayList<>();
        if (propId == PROP_CURRENT_HP && valueLen >= 2 && 12 + 2 <= payload.length) {
            // 当前血量：u16 LE（含装备加成）。受击时客户端同步，阵亡到 0、存活不到 0。
            final int currentHp = (payload[12] & 0xFF) | ((payload[13] & 0xFF) << 8);
            events.add(new HealthChangedEvent(
                    packet.sequence(), ts, packet.type(),
                    DecodeConfidence.EXACT,
                    entityId,
                    currentHp,
                    null,
                    currentHp > 0));
            return new ReplayDecodeResult(
                    warnings.isEmpty() ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL,
                    events, warnings);
        }
        if (propId == PROP_TURRET_RELATIVE_YAW && valueLen >= 2 && 12 + 2 <= payload.length) {
            // 炮塔相对车体偏航（u16 LE）：度 = raw*360/65536 - 180（完整 360°，±180 回绕）。
            final int raw = (payload[12] & 0xFF) | ((payload[13] & 0xFF) << 8);
            final double deg = raw * TURRET_YAW_SCALE_DEG + TURRET_YAW_OFFSET_DEG;
            events.add(new TurretDirectionChangedEvent(
                    packet.sequence(), ts, packet.type(),
                    DecodeConfidence.EXACT, entityId, deg));
            return new ReplayDecodeResult(
                    warnings.isEmpty() ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL,
                    events, warnings);
        }
        // 其它 propId 语义未确认：只保留结构信息，不臆断语义，避免向上层/AI 提供伪造数据。
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
