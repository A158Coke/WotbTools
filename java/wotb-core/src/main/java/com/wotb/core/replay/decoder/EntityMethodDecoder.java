package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Type 8 (EntityMethod) 解码器。
 * <p>
 * 复用现有解析逻辑：
 * <ul>
 *   <li>entity/account 映射（subtype 48 updateArena2）</li>
 *   <li>direct HP damage（subtype 8 damage, sub 3 direct）</li>
 *   <li>updateArena（subtype 47）</li>
 * </ul>
 * </p>
 */
public class EntityMethodDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_METHOD = 8;
    static final int SUBTYPE_UPDATE_ARENA = 47;
    static final int SUBTYPE_UPDATE_ARENA2 = 48;
    static final int SUBTYPE_ENTITY_METHOD_DAMAGE = 8;
    static final int DAMAGE_SUB_DIRECT = 3;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_METHOD;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 8) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "EntityMethod packet too short: " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final int subType = readU32LE(payload, 4);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        final List<ReplayEvent> events = new ArrayList<>();
        final List<ReplayDecodeWarning> warnings = new ArrayList<>();

        switch (subType) {
            case SUBTYPE_ENTITY_METHOD_DAMAGE -> {
                // damage event
                final DamageResult damageResult = parseDamage(payload, entityId, packet, ts);
                if (damageResult != null) {
                    events.add(damageResult.damageEvent());
                    if (damageResult.destroyedEvent() != null) {
                        events.add(damageResult.destroyedEvent());
                    }
                } else {
                    // 结构合法但语义未解码的伤害方法变体（非 direct/零伤害/短体变体）：
                    // 可能对应跳弹/履带/模块/其他通知，未经证明；不产出事件、不进入生产时间线，
                    // 也不算解析失败（区别于真正的 MALFORMED/TRUNCATED）。
                    warnings.add(new ReplayDecodeWarning("UNSUPPORTED_DAMAGE_VARIANT",
                            "Undecoded damage-method variant at seq " + packet.sequence()
                                    + " (payloadLen=" + payload.length + ")"));
                }
            }
            case SUBTYPE_UPDATE_ARENA2 -> {
                // entity/account mapping
                final ParticipantMappingResult mapping = parseUpdateArena2(payload, entityId, packet, ts);
                if (mapping != null) {
                    events.addAll(mapping.mappingEvents());
                }
                // 争霸赛实时点数（root field 12，保守结构校验；结构不合法/数值非法 → 跳过）
                events.addAll(parseSupremacyPoints(payload, packet, ts));
            }
            case SUBTYPE_UPDATE_ARENA -> {
                // updateArena - 暂时不做实体映射，现有功能已覆盖
                // 后续可以解析 arena snapshot
            }
            default ->
                // 未知 subtype，记录 unknown 事件
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE",
                            "Unknown EntityMethod subtype: " + subType));

        }

        final DecodeStatus status = warnings.isEmpty() ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL;
        return new ReplayDecodeResult(status, events, warnings);
    }

    private DamageResult parseDamage(byte[] payload, int entityId, RawReplayPacket packet, ReplayTimestamp ts) {
        if (payload.length < 25) {
            return null;
        }
        final byte[] body = new byte[payload.length - 8];
        System.arraycopy(payload, 8, body, 0, body.length);

        if (body.length < 18 || (body[13] & 0xFF) != DAMAGE_SUB_DIRECT) {
            return null;
        }

        final int attackerEid = readI32LE(body, 4);
        final int victimEid = readI32LE(body, 8);

        final int damage = (body[14] & 0xFF) << 8 | (body[15] & 0xFF);
        if (damage <= 0) {
            return null;
        }

        final DamageEvent damageEvent = new DamageEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                attackerEid, victimEid, null, null, damage, false);

        return new DamageResult(damageEvent, null);
    }

    /**
     * 解析 subtype 48 (updateArena2) 的 entity→account 映射。
     */
    private ParticipantMappingResult parseUpdateArena2(
            byte[] payload, int entityId, RawReplayPacket packet, ReplayTimestamp ts) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        if (decoded == null || decoded.wrapperFieldNumber() != WRAPPER_ROSTER) {
            return null;
        }
        // 名册映射：wrapper=1 → root field 1 = wrapper protobuf，其 field 1 = 玩家列表
        final Map<Integer, List<Object>> root = decoded.root();
        final Object wrapperRaw = ProtobufDecoder.first(root, 1);
        if (!(wrapperRaw instanceof byte[] wrapperBytes)) {
            return null;
        }
        final var wrapper = ProtobufDecoder.decode(wrapperBytes);
        final List<Object> playerList = wrapper.get(1);
        if (playerList == null) {
            return null;
        }
        final List<ParticipantMappingEvent> mappings = new ArrayList<>();
        for (final Object pRaw : playerList) {
            if (!(pRaw instanceof byte[] playerBytes)) continue;
            final var p = ProtobufDecoder.decode(playerBytes);
            final int eid = (int) ProtobufDecoder.firstLong(p, 1, 0);
            final long acc = ProtobufDecoder.firstLong(p, 7, 0);
            final String nickname = decodeUtf8(ProtobufDecoder.first(p, 3));
            final int team = (int) ProtobufDecoder.firstLong(p, 4, 0);
            if (eid != 0 && (acc != 0 || StringUtils.hasText(nickname))) {
                mappings.add(new ParticipantMappingEvent(
                        packet.sequence(), ts, packet.type(),
                        DecodeConfidence.EXACT, eid, acc, nickname, team));
            }
        }
        if (mappings.isEmpty()) {
            return null;
        }
        return new ParticipantMappingResult(mappings);
    }

    /**
     * 解析 subtype 48 (updateArena2) 实时争霸点数广播（wrapper=13 → root field 12，PROVEN）。
     * <p>门禁（缺一不可）：packet type 8 / subtype 48 / <b>wrapperFieldNumber == 13</b> /
     * root field 12 存在 / 每条 nested field 1 = team（1/2）/ field 2 = 点数合法。
     * wrapperFieldNumber != 13 时即使 root 结构相同也绝不产出点数事件。
     * 已对 5 个真实回放交叉验证（事件数 185/161/69/204/201、点数区间与击毁 ±40 点事件吻合）；
     * 只消费回放真实广播，绝不按游戏规则推算。</p>
     */
    private List<SupremacyPointsChangedEvent> parseSupremacyPoints(
            byte[] payload, RawReplayPacket packet, ReplayTimestamp ts) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        if (decoded == null || decoded.wrapperFieldNumber() != WRAPPER_SUPREMACY_POINTS) {
            return List.of();
        }
        final Map<Integer, List<Object>> root = decoded.root();
        final List<Object> teamBlocks = root.get(12);
        if (teamBlocks == null || teamBlocks.isEmpty()) {
            return List.of();
        }
        final List<SupremacyPointsChangedEvent> out = new ArrayList<>();
        for (final Object blockRaw : teamBlocks) {
            if (!(blockRaw instanceof byte[] block)) {
                continue;
            }
            final var blockFields = ProtobufDecoder.decode(block);
            final long team = ProtobufDecoder.firstLong(blockFields, 1, -1);
            final long points = ProtobufDecoder.firstLong(blockFields, 2, -1);
            if (team != 1 && team != 2) {
                continue;
            }
            if (points < 0 || points > 100_000) {
                continue;
            }
            out.add(new SupremacyPointsChangedEvent(
                    packet.sequence(), ts, packet.type(),
                    DecodeConfidence.EXACT, (int) team, (int) points));
        }
        return out;
    }

    /**
     * 提取 subtype48 的 wrapperFieldNumber + root protobuf。
     * body 结构（已逆向确认）：body[0..3] 固定前缀 + varint(wrapperFieldNumber) +
     * msgLen(0xFF 双字节或单字节) + protoData(root protobuf)。
     */
    private static DecodedUpdateArena2 decodeUpdateArena2(final byte[] payload) {
        final byte[] body = new byte[payload.length - 8];
        System.arraycopy(payload, 8, body, 0, body.length);
        try {
            int off = 4;
            if (off >= body.length) {
                return null;
            }
            final long[] varRes = readVarint(body, off);
            final long wrapperFieldNumber = varRes[0];
            off = (int) varRes[1];
            if (off >= body.length) {
                return null;
            }
            final int msgLen;
            final int first = body[off] & 0xFF;
            if (first == 0xFF) {
                if (off + 2 > body.length) {
                    return null;
                }
                msgLen = readU16LE(body, off + 1);
                off += 4;
            } else {
                msgLen = first;
                off += 1;
            }
            if (off + msgLen > body.length) {
                return null;
            }
            final byte[] protoData = new byte[msgLen];
            System.arraycopy(body, off, protoData, 0, msgLen);
            return new DecodedUpdateArena2(wrapperFieldNumber, ProtobufDecoder.decode(protoData));
        } catch (Exception e) {
            return null;
        }
    }

    /** 供探针/诊断读取 subtype48 的 wrapper field_number（复用生产提取；-1=结构不完整）。 */
    public static long readWrapperFieldNumber(final byte[] payload) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        return decoded == null ? -1 : decoded.wrapperFieldNumber();
    }

    /** 供探针/诊断读取 subtype48 的 root protobuf（复用生产提取；null=结构不完整）。 */
    public static Map<Integer, List<Object>> readUpdateArena2Root(final byte[] payload) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        return decoded == null ? null : decoded.root();
    }

    private static String decodeUtf8(final Object value) {
        return value instanceof byte[] bytes
                ? new String(bytes, StandardCharsets.UTF_8) : "";
    }

    // ---- 内部辅助类和工具方法 ----

    /** subtype48 名册映射（wrapper field_number = 1）。 */
    public static final long WRAPPER_ROSTER = 1L;
    /** subtype48 实时争霸点数（wrapper field_number = 13 → root field 12）。 */
    public static final long WRAPPER_SUPREMACY_POINTS = 13L;

    /** subtype48 解码结果：wrapper field_number + root protobuf（两层字段，不得混用）。 */
    private record DecodedUpdateArena2(
            long wrapperFieldNumber,
            Map<Integer, List<Object>> root
    ) {
    }

    private record DamageResult(DamageEvent damageEvent, VehicleDestroyedEvent destroyedEvent) {
    }

    private record ParticipantMappingResult(List<ParticipantMappingEvent> mappingEvents) {
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    static int readU16LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }

    static long[] readVarint(byte[] buf, int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (true) {
            // 边界与长度保护：截断的 varint 不得越界读取，最多 10 字节（64 位）。
            if (idx >= buf.length || shift >= 64) {
                throw new IllegalArgumentException("Malformed varint at offset " + i);
            }
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return new long[]{result, idx};
    }
}
