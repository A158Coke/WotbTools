package com.wotb.core.parse;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 事件流类型提取器：EntityLeave/Position/updateArena/EntityMethod 伤害与击杀归因提取，
 * 含 protobuf 嵌套解析。
 * <p>从 {@link EventStreamReader} 拆出，纯静态工具类。</p>
 */
final class ReplayEventExtractors {

    private ReplayEventExtractors() {
    }

    static final int TYPE_BASE_PLAYER_CREATE = 0;
    static final int TYPE_ENTITY_LEAVE = 4;
    static final int TYPE_ENTITY_METHOD = 8;
    static final int TYPE_POSITION = 10;
    static final int SUBTYPE_UPDATE_ARENA = 47;
    static final int SUBTYPE_UPDATE_ARENA2 = 48;
    static final int SUBTYPE_ENTITY_METHOD_DAMAGE = 8;
    // damage body body[13] subtypes:
    static final int DAMAGE_SUB_DIRECT = 3;       // direct HP damage

    /**
     * 提取 EntityLeave 事件列表。
     * Type 4 包负载 = entity_id (i32 LE)。
     */
    public static List<EventStreamReader.EntityLeaveEvent> extractEntityLeaves(List<EventStreamReader.ParsedPacket> packets) {
        final List<EventStreamReader.EntityLeaveEvent> leaves = new ArrayList<>();
        for (final EventStreamReader.ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_ENTITY_LEAVE || pkt.payload.length < 4) {
                continue;
            }
            final int eid = ReplayPacketParser.readI32LE(pkt.payload, 0);
            leaves.add(new EventStreamReader.EntityLeaveEvent(pkt.clockSecs, eid));
        }
        return leaves;
    }

    /**
     * 提取所有 Position 数据。
     * BigWorld 格式含 space_id: entityId(i32) + spaceId(i32) + vehicleId(i32)
     * + position(3xf32) + positionError(3xf32) + yaw/pitch/roll(3xf32) + is_error(i8) = 49B。
     */
    public static List<EventStreamReader.PositionData> extractPositions(List<EventStreamReader.ParsedPacket> packets) {
        final List<EventStreamReader.PositionData> positions = new ArrayList<>();
        for (final EventStreamReader.ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_POSITION || pkt.payload.length < 45) {
                continue;
            }
            final byte[] pl = pkt.payload;
            final int eid = ReplayPacketParser.readI32LE(pl, 0);
            final int sid = ReplayPacketParser.readI32LE(pl, 4);
            final int vid = ReplayPacketParser.readI32LE(pl, 8);
            final float x = Float.intBitsToFloat(ReplayPacketParser.readU32LE(pl, 12));
            final float y = Float.intBitsToFloat(ReplayPacketParser.readU32LE(pl, 16));
            final float z = Float.intBitsToFloat(ReplayPacketParser.readU32LE(pl, 20));
            final float yaw = Float.intBitsToFloat(ReplayPacketParser.readU32LE(pl, 36));
            final float pitch = Float.intBitsToFloat(ReplayPacketParser.readU32LE(pl, 40));
            final float roll = Float.intBitsToFloat(ReplayPacketParser.readU32LE(pl, 44));
            if (Math.abs(x) > 5000 || Math.abs(z) > 5000 || Math.abs(y) > 200) {
                continue;
            }
            positions.add(new EventStreamReader.PositionData(pkt.clockSecs, eid, sid, vid,
                    x, y, z, yaw, pitch, roll));
        }
        return positions;
    }

    /**
     * 从 Type 8 Method 48 (updateArena2) 提取 entity_id → account_id 映射。
     *
     * <p>格式: remaining_len(u32 LE) + field_number(varint) + quirky_len + protobuf。
     * protobuf 内 field 1 (len-delim) 包裹所有玩家。
     * 每个玩家: field 1 (len-delim) 内含 entity_id(fn1), name(fn3), team(fn4), account_id(fn7)。
     */
    public static Map<Integer, Long> extractEntityToAccountMap(List<EventStreamReader.ParsedPacket> packets) {
        final Map<Integer, Long> map = new HashMap<>();
        for (final EventStreamReader.ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_ENTITY_METHOD) {
                continue;
            }
            final byte[] raw = pkt.payload;
            if (raw.length < 8) continue;
            final int eid = ReplayPacketParser.readI32LE(raw, 0);
            final int subType = ReplayPacketParser.readU32LE(raw, 4);
            if (subType != SUBTYPE_UPDATE_ARENA2) continue;
            final byte[] body = new byte[raw.length - 8];
            System.arraycopy(raw, 8, body, 0, body.length);
            try {
                final Map<Integer, Long> partial = parseUpdateArena2(body, pkt.clockSecs);
                map.putAll(partial);
            } catch (Exception ignored) {
            }
        }
        return map;
    }

    private static Map<Integer, Long> parseUpdateArena2(byte[] body, float clockSecs) {
        final Map<Integer, Long> result = new HashMap<>();
        int off = 4;
        final long[] varRes = ReplayPacketParser.readVarint(body, off);
        off = (int) varRes[1];
        final int msgLen = readQuirkyLength(body, off);
        final int msgLenSize = (body[off] & 0xFF) == 0xFF ? 4 : 1;
        off += msgLenSize;
        if (off + msgLen > body.length) return result;
        final byte[] protoData = new byte[msgLen];
        System.arraycopy(body, off, protoData, 0, msgLen);

        final Map<Integer, List<Object>> root = Protobuf.decode(protoData);
        final Object wrapperRaw = Protobuf.first(root, 1);
        if (!(wrapperRaw instanceof byte[])) return result;
        final Map<Integer, List<Object>> wrapper = Protobuf.decode((byte[]) wrapperRaw);
        final List<Object> playerList = wrapper.get(1);
        if (playerList == null) return result;

        for (final Object pRaw : playerList) {
            if (!(pRaw instanceof byte[])) continue;
            final Map<Integer, List<Object>> p = Protobuf.decode((byte[]) pRaw);
            final int eid = (int) Protobuf.firstLong(p, 1, 0);
            final long acc = Protobuf.firstLong(p, 7, 0);
            if (eid != 0 && acc != 0) {
                result.put(eid, acc);
            }
        }
        return result;
    }

    public static List<EventStreamReader.DirectDamageEvent> extractDirectDamageEvents(
            final List<EventStreamReader.ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount) {
        final List<EventStreamReader.DirectDamageEvent> events = new ArrayList<>();
        for (final EventStreamReader.ParsedPacket packet : packets) {
            final EventStreamReader.DirectDamageEvent event = parseDirectDamageEvent(packet, entityToAccount);
            if (event != null) {
                events.add(event);
            }
        }
        return events;
    }

    public static Map<Long, List<EventStreamReader.KillVictimDamage>> extractKillVictims(
            final List<EventStreamReader.ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount,
            final Map<Long, Integer> accountToThreshold) {
        final List<EventStreamReader.DirectDamageEvent> events = extractDirectDamageEvents(packets, entityToAccount);
        events.sort(Comparator.comparingDouble(EventStreamReader.DirectDamageEvent::clockSecs));

        final Map<Long, Integer> directTotalByVictim = new HashMap<>();
        for (final EventStreamReader.DirectDamageEvent event : events) {
            directTotalByVictim.merge(event.victimAccountId(), event.damage(), Integer::sum);
        }

        final Map<Long, Integer> cumulativeByVictim = new HashMap<>();
        final Map<DamagePair, DamageBucket> damageByPair = new HashMap<>();
        final Map<Long, List<EventStreamReader.KillVictimDamage>> victimsByKiller = new HashMap<>();
        final Set<Long> completedVictims = new HashSet<>();
        for (final EventStreamReader.DirectDamageEvent event : events) {
            final long victimAccountId = event.victimAccountId();
            if (completedVictims.contains(victimAccountId)) {
                continue;
            }

            final int previousDamage = cumulativeByVictim.getOrDefault(victimAccountId, 0);
            final int nextDamage = previousDamage + event.damage();
            cumulativeByVictim.put(victimAccountId, nextDamage);

            if (event.attackerAccountId() != victimAccountId) {
                final DamagePair pair = new DamagePair(event.attackerAccountId(), victimAccountId);
                final DamageBucket bucket = damageByPair.computeIfAbsent(pair, ignored -> new DamageBucket());
                bucket.damage += event.damage();
                bucket.penetrations++;
            }

            final Integer receivedThreshold = accountToThreshold.get(victimAccountId);
            if (receivedThreshold == null || receivedThreshold <= 0) {
                continue;
            }
            final int directTotal = directTotalByVictim.getOrDefault(victimAccountId, 0);
            if (directTotal < receivedThreshold) {
                continue;
            }
            final int threshold = receivedThreshold;
            if (threshold <= 0 || previousDamage >= threshold || nextDamage < threshold) {
                continue;
            }
            completedVictims.add(victimAccountId);

            final long killerAccountId = event.attackerAccountId();
            if (killerAccountId == victimAccountId) {
                continue;
            }
            final DamageBucket bucket = damageByPair.get(new DamagePair(killerAccountId, victimAccountId));
            if (bucket == null || bucket.damage <= 0 || bucket.penetrations <= 0) {
                continue;
            }
            victimsByKiller.computeIfAbsent(killerAccountId, ignored -> new ArrayList<>())
                    .add(new EventStreamReader.KillVictimDamage(killerAccountId, victimAccountId,
                            bucket.damage, bucket.penetrations));
        }
        return victimsByKiller;
    }

    private static EventStreamReader.DirectDamageEvent parseDirectDamageEvent(
            final EventStreamReader.ParsedPacket packet,
            final Map<Integer, Long> entityToAccount) {
        if (packet.type != TYPE_ENTITY_METHOD || packet.payload.length < 12) {
            return null;
        }
        if (ReplayPacketParser.readU32LE(packet.payload, 4) != SUBTYPE_ENTITY_METHOD_DAMAGE) {
            return null;
        }
        final byte[] body = new byte[packet.payload.length - 8];
        System.arraycopy(packet.payload, 8, body, 0, body.length);
        if (body.length != 25 || (body[13] & 0xFF) != DAMAGE_SUB_DIRECT) {
            return null;
        }

        final int attackerEid = ReplayPacketParser.readI32LE(body, 4);
        final int victimEid = ReplayPacketParser.readI32LE(body, 8);
        final Long attackerAccountId = entityToAccount.get(attackerEid);
        final Long victimAccountId = entityToAccount.get(victimEid);
        if (attackerAccountId == null || victimAccountId == null) {
            return null;
        }
        final int damage = (body[14] & 0xFF) << 8 | (body[15] & 0xFF);
        if (damage <= 0) {
            return null;
        }
        return new EventStreamReader.DirectDamageEvent(packet.clockSecs, attackerAccountId, victimAccountId, damage);
    }

    private record DamagePair(long attackerAccountId, long victimAccountId) {
    }

    private static final class DamageBucket {
        private int damage;
        private int penetrations;
    }

    // ---- EntityMethod 解析 ----

    public static List<EventStreamReader.ArenaSnapshot> extractArenaSnapshots(List<EventStreamReader.ParsedPacket> packets) {
        final List<EventStreamReader.ArenaSnapshot> snapshots = new ArrayList<>();
        for (final EventStreamReader.ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_ENTITY_METHOD) {
                continue;
            }
            final EntityMethodResult em = parseEntityMethod(pkt.payload);
            if (em == null || em.subType != SUBTYPE_UPDATE_ARENA) {
                continue;
            }
            final EventStreamReader.ArenaSnapshot snap = parseUpdateArena(em.innerPayload, pkt.clockSecs);
            if (snap != null) {
                snapshots.add(snap);
            }
        }
        return snapshots;
    }

    private static final class EntityMethodResult {
        final int subType;
        final byte[] innerPayload;

        EntityMethodResult(int subType, byte[] innerPayload) {
            this.subType = subType;
            this.innerPayload = innerPayload;
        }
    }

    private static EntityMethodResult parseEntityMethod(byte[] raw) {
        if (raw.length < 8) {
            return null;
        }
        int i = 4;
        final int subType = ReplayPacketParser.readU32LE(raw, i);
        i += 4;
        if (subType != SUBTYPE_UPDATE_ARENA) {
            return new EntityMethodResult(subType, null);
        }
        if (i + 4 > raw.length) {
            return new EntityMethodResult(subType, null);
        }
        i += 4;
        final long[] varRes = ReplayPacketParser.readVarint(raw, i);
        i = (int) varRes[1];
        final int msgLen = readQuirkyLength(raw, i);
        final int msgLenSize = (raw[i] & 0xFF) == 0xFF ? 4 : 1;
        i += msgLenSize;
        if (i + msgLen > raw.length) {
            return new EntityMethodResult(subType, null);
        }
        final byte[] inner = new byte[msgLen];
        System.arraycopy(raw, i, inner, 0, msgLen);
        return new EntityMethodResult(subType, inner);
    }

    private static int readQuirkyLength(byte[] buf, int i) {
        final int first = buf[i] & 0xFF;
        if (first == 0xFF) {
            return ReplayPacketParser.readU16LE(buf, i + 1);
        }
        return first;
    }

    private static EventStreamReader.ArenaSnapshot parseUpdateArena(byte[] inner, float clockSecs) {
        final Map<Integer, List<Object>> updateArena = Protobuf.decode(inner);
        final Object playersRaw = Protobuf.first(updateArena, 1);
        if (!(playersRaw instanceof byte[])) {
            return null;
        }
        final Map<Integer, List<Object>> playersMsg = Protobuf.decode((byte[]) playersRaw);
        final List<Object> playerList = playersMsg.get(1);
        if (playerList == null) {
            return new EventStreamReader.ArenaSnapshot(clockSecs, new HashSet<>());
        }
        final Set<Long> accountIds = new HashSet<>();
        for (final Object pRaw : playerList) {
            if (!(pRaw instanceof byte[])) {
                continue;
            }
            final Map<Integer, List<Object>> p = Protobuf.decode((byte[]) pRaw);
            final long acc = Protobuf.firstLong(p, 7, 0);
            if (acc != 0) {
                accountIds.add(acc);
            }
        }
        return new EventStreamReader.ArenaSnapshot(clockSecs, accountIds);
    }

}
