package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

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
                    warnings.add(new ReplayDecodeWarning("PARSE_FAILED",
                            "Failed to parse damage from EntityMethod at seq " + packet.sequence()));
                }
            }
            case SUBTYPE_UPDATE_ARENA2 -> {
                // entity/account mapping
                final ParticipantMappingResult mapping = parseUpdateArena2(payload, entityId, packet, ts);
                if (mapping != null) {
                    events.addAll(mapping.mappingEvents());
                }
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

        final byte[] body = new byte[payload.length - 8];
        System.arraycopy(payload, 8, body, 0, body.length);

        final List<ParticipantMappingEvent> mappings = new ArrayList<>();

        try {
            int off = 4;
            if (off >= body.length) return null;

            final long[] varRes = readVarint(body, off);
            off = (int) varRes[1];

            if (off >= body.length) return null;
            final int msgLenSize;
            final int msgLen;
            final int first = body[off] & 0xFF;
            if (first == 0xFF) {
                if (off + 2 > body.length) return null;
                msgLenSize = 4;
                msgLen = readU16LE(body, off + 1);
            } else {
                msgLenSize = 1;
                msgLen = first;
            }
            off += msgLenSize;
            if (off + msgLen > body.length) return null;

            final byte[] protoData = new byte[msgLen];
            System.arraycopy(body, off, protoData, 0, msgLen);

            final var root = ProtobufDecoder.decode(protoData);
            final Object wrapperRaw = ProtobufDecoder.first(root, 1);
            if (!(wrapperRaw instanceof byte[] wrapperBytes)) return null;
            final var wrapper = ProtobufDecoder.decode(wrapperBytes);
            final List<Object> playerList = wrapper.get(1);
            if (playerList == null) return null;

            for (final Object pRaw : playerList) {
                if (!(pRaw instanceof byte[] playerBytes)) continue;
                final var p = ProtobufDecoder.decode(playerBytes);
                final int eid = (int) ProtobufDecoder.firstLong(p, 1, 0);
                final long acc = ProtobufDecoder.firstLong(p, 7, 0);
                if (eid != 0 && acc != 0) {
                    mappings.add(new ParticipantMappingEvent(
                            packet.sequence(), ts, packet.type(),
                            DecodeConfidence.EXACT, eid, acc));
                }
            }
        } catch (Exception e) {
            return null;
        }

        if (mappings.isEmpty()) return null;
        return new ParticipantMappingResult(mappings);
    }

    // ---- 内部辅助类和工具方法 ----

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
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return new long[]{result, idx};
    }
}
