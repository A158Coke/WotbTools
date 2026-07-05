package com.wotb.core.parse;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 解析 data.wotreplay 事件流。
 *
 * <p>包头: 魔数(4) + 未知(8) + hash(1+len) + version(1+len) + 1字节填充。
 * 后跟 N 个事件包: payload_len(4) + type(4) + clock(f32 4) + payload(len 字节)。
 *
 * <p>错误容忍: 遇到坏包时跳过 1 字节继续 (整个文件都是包序列)。</p>
 */
public final class EventStreamReader {

    private static final int MAGIC = 0x12345678;
    static final int TYPE_BASE_PLAYER_CREATE = 0;
    static final int TYPE_ENTITY_LEAVE = 4;
    static final int TYPE_ENTITY_METHOD = 8;
    static final int TYPE_POSITION = 10;
    static final int SUBTYPE_UPDATE_ARENA = 47;
    static final int SUBTYPE_UPDATE_ARENA2 = 48;
    static final int SUBTYPE_ENTITY_METHOD_DAMAGE = 8;
    // damage body body[13] subtypes:
    static final int DAMAGE_SUB_DIRECT = 3;       // direct HP damage
    private static final int MAX_PAYLOAD_LEN = 200_000;
    private static final float MAX_SANE_CLOCK = 5000f;

    private EventStreamReader() {
    }

    /** One direct HP damage event resolved from replay entity ids to account ids. */
    public record DirectDamageEvent(float clockSecs, long attackerAccountId,
                                    long victimAccountId, int damage) {
    }

    /** Damage dealt by one killer to one victim before the victim is inferred dead. */
    public record KillVictimDamage(long killerAccountId, long victimAccountId,
                                   int damage, int penetrations) {
    }

    public static final class EventStream {
        public final String clientVersion;
        public final String clientHash;
        public final List<ParsedPacket> packets;

        public EventStream(String clientVersion, String clientHash, List<ParsedPacket> packets) {
            this.clientVersion = clientVersion;
            this.clientHash = clientHash;
            this.packets = packets;
        }
    }

    public static final class ParsedPacket {
        public final int type;
        public final float clockSecs;
        public final byte[] payload;

        public ParsedPacket(int type, float clockSecs, byte[] payload) {
            this.type = type;
            this.clockSecs = clockSecs;
            this.payload = payload;
        }
    }

    public static final class ArenaSnapshot {
        public final float clockSecs;
        public final Set<Long> accountIds;

        public ArenaSnapshot(float clockSecs, Set<Long> accountIds) {
            this.clockSecs = clockSecs;
            this.accountIds = accountIds;
        }
    }

    /** Type 4 (EntityLeave) 事件: 实体离开竞技场。 */
    public static final class EntityLeaveEvent {
        public final float clockSecs;
        public final int entityId;

        public EntityLeaveEvent(float clockSecs, int entityId) {
            this.clockSecs = clockSecs;
            this.entityId = entityId;
        }
    }

    /** Type 10 (Position) 解码结果。 */
    public static final class PositionData {
        public final float clockSecs;
        public final int entityId;
        public final int spaceId;
        public final int vehicleId;
        public final float x, y, z;
        public final float yaw, pitch, roll;

        public PositionData(float clockSecs, int entityId, int spaceId, int vehicleId,
                            float x, float y, float z, float yaw, float pitch, float roll) {
            this.clockSecs = clockSecs;
            this.entityId = entityId;
            this.spaceId = spaceId;
            this.vehicleId = vehicleId;
            this.x = x;
            this.y = y;
            this.z = z;
            this.yaw = yaw;
            this.pitch = pitch;
            this.roll = roll;
        }
    }

    /**
     * 解析整个 data.wotreplay (错误容忍)。
     */
    public static EventStream read(byte[] data) {
        int i = 0;
        final int n = data.length;

        // header
        final int magic = readU32LE(data, i);
        i += 4;
        if (magic != MAGIC) {
            throw new IllegalArgumentException("Bad magic: " + Integer.toHexString(magic));
        }
        i += 8;
        final String clientHash = readLenPrefixedStr(data, i);
        i += 1 + clientHash.length();
        final String clientVersion = readLenPrefixedStr(data, i);
        i += 1 + clientVersion.length();
        i += 1;

        // packets (error-tolerant)
        final List<ParsedPacket> packets = new ArrayList<>();
        while (i + 12 <= n) {
            final int payloadLen = readU32LE(data, i);
            if (payloadLen <= 0 || payloadLen > MAX_PAYLOAD_LEN) {
                i++;
                continue;
            }
            if (i + 8 + payloadLen > n) {
                i++;
                continue;
            }
            final int type = readU32LE(data, i + 4);
            final float clockSecs = Float.intBitsToFloat(readU32LE(data, i + 8));
            if (clockSecs < 0 || clockSecs > MAX_SANE_CLOCK) {
                i++;
                continue;
            }
            final byte[] payload = new byte[payloadLen];
            System.arraycopy(data, i + 12, payload, 0, payloadLen);
            packets.add(new ParsedPacket(type, clockSecs, payload));
            i += 12 + payloadLen;
        }

        return new EventStream(clientVersion, clientHash, packets);
    }

    /**
     * 提取 EntityLeave 事件列表。
     * Type 4 包负载 = entity_id (i32 LE)。
     */
    public static List<EntityLeaveEvent> extractEntityLeaves(List<ParsedPacket> packets) {
        final List<EntityLeaveEvent> leaves = new ArrayList<>();
        for (final ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_ENTITY_LEAVE || pkt.payload.length < 4) {
                continue;
            }
            final int eid = readI32LE(pkt.payload, 0);
            leaves.add(new EntityLeaveEvent(pkt.clockSecs, eid));
        }
        return leaves;
    }

    /**
     * 提取所有 Position 数据。
     * BigWorld 格式含 space_id: entityId(i32) + spaceId(i32) + vehicleId(i32)
     * + position(3xf32) + positionError(3xf32) + yaw/pitch/roll(3xf32) + is_error(i8) = 49B。
     */
    public static List<PositionData> extractPositions(List<ParsedPacket> packets) {
        final List<PositionData> positions = new ArrayList<>();
        for (final ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_POSITION || pkt.payload.length < 45) {
                continue;
            }
            final byte[] pl = pkt.payload;
            final int eid = readI32LE(pl, 0);
            final int sid = readI32LE(pl, 4);
            final int vid = readI32LE(pl, 8);
            final float x = Float.intBitsToFloat(readU32LE(pl, 12));
            final float y = Float.intBitsToFloat(readU32LE(pl, 16));
            final float z = Float.intBitsToFloat(readU32LE(pl, 20));
            final float yaw = Float.intBitsToFloat(readU32LE(pl, 36));
            final float pitch = Float.intBitsToFloat(readU32LE(pl, 40));
            final float roll = Float.intBitsToFloat(readU32LE(pl, 44));
            if (Math.abs(x) > 5000 || Math.abs(z) > 5000 || Math.abs(y) > 200) {
                continue;
            }
            positions.add(new PositionData(pkt.clockSecs, eid, sid, vid,
                    x, y, z, yaw, pitch, roll));
        }
        return positions;
    }

    /**
     * 根据 EntityLeave 事件推算死亡时间。
     * 取该实体最后一次 leave 的时刻作为死亡时间。
     */
    public static double estimateDeathTimeByEntity(
            int entityId, double battleDurationS, List<EntityLeaveEvent> leaves) {
        double last = 0;
        for (final EntityLeaveEvent ev : leaves) {
            if (ev.entityId == entityId && ev.clockSecs > 0) {
                last = Math.max(last, ev.clockSecs);
            }
        }
        return last > 0 ? Math.min(last, battleDurationS) : 0;
    }

    /**
     * 从 Type 8 Method 48 (updateArena2) 提取 entity_id → account_id 映射。
     *
     * <p>格式: remaining_len(u32 LE) + field_number(varint) + quirky_len + protobuf。
     * protobuf 内 field 1 (len-delim) 包裹所有玩家。
     * 每个玩家: field 1 (len-delim) 内含 entity_id(fn1), name(fn3), team(fn4), account_id(fn7)。
     */
    public static Map<Integer, Long> extractEntityToAccountMap(List<ParsedPacket> packets) {
        final Map<Integer, Long> map = new HashMap<>();
        for (final ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_ENTITY_METHOD) {
                continue;
            }
            final byte[] raw = pkt.payload;
            if (raw.length < 8) continue;
            final int eid = readI32LE(raw, 0);
            final int subType = readU32LE(raw, 4);
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
        final long[] varRes = readVarint(body, off);
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

    /**
     * 用 entity_id ↔ account_id 映射 + EntityLeave 事件推算各玩家的死亡时间秒。
     * 返回 map: account_id → death_time_sec (0=未知,存活返回战斗时长)。
     */
    public static Map<Long, Double> estimateDeathTimesByEntityLeaves(
            List<ParsedPacket> packets, double battleDurationS) {
        final Map<Integer, Long> entityToAccount = extractEntityToAccountMap(packets);
        final List<EntityLeaveEvent> leaves = extractEntityLeaves(packets);
        final Map<Long, Double> deathTimes = new HashMap<>();
        for (final Map.Entry<Integer, Long> entry : entityToAccount.entrySet()) {
            final double dt = estimateDeathTimeByEntity(entry.getKey(), battleDurationS, leaves);
            deathTimes.put(entry.getValue(), dt);
        }
        return deathTimes;
    }

    /**
     * 用 entity_id ↔ account_id 映射 + Position 事件推算各玩家死亡时间。
     * Position 更新停止的时间 ≈ 玩家阵亡时间（玩家阵亡后不再发送坐标）。
     * 返回 map: account_id → death_time_sec (0=未知).
     */
    public static Map<Long, Double> estimateDeathTimesByPositions(
            List<ParsedPacket> packets, double battleDurationS) {
        final Map<Integer, Long> entityToAccount = extractEntityToAccountMap(packets);
        final List<PositionData> positions = extractPositions(packets);
        final Map<Integer, Double> lastPosByEid = new HashMap<>();
        for (final PositionData pos : positions) {
            lastPosByEid.merge(pos.entityId, (double) pos.clockSecs, Math::max);
        }
        final Map<Long, Double> deathTimes = new HashMap<>();
        for (final Map.Entry<Integer, Long> entry : entityToAccount.entrySet()) {
            final double lastPos = lastPosByEid.getOrDefault(entry.getKey(), 0.0);
            final double dt = lastPos > 0 ? Math.min(lastPos, battleDurationS) : 0;
            deathTimes.put(entry.getValue(), dt);
        }
        return deathTimes;
    }

    /**
     * 用 Type 8 EntityMethod (subtype 8 = damage) 推算各玩家死亡时间秒。
     * body 25B 格式: len(4) + attackerEid(4) + victimEid(4) + type(1) + sub(1) + dmgBE(2) + data(6) + flag(1)
     * sub=3 = direct HP damage. 双遍扫描：
     *   第 1 遍: 累计每个玩家的 sub3 总量 (sub3Total)。
     *   第 2 遍: 按时间顺序推进, 当累计值 >= threshold (= min(accountToThreshold, sub3Total)) 时记录阵亡时刻。
     * 返回 map: account_id → death_time_sec (0=未知).
     */
    public static Map<Long, Double> estimateDeathTimesByDamage(
            final List<ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount,
            final Map<Long, Integer> accountToThreshold,
            final double battleDurationS) {
        // 先行一步: 提取所有 sub3 事件并排序
        final List<DirectDamageEvent> events = extractDirectDamageEvents(packets, entityToAccount);
        events.sort(Comparator.comparingDouble(DirectDamageEvent::clockSecs));

        // 第 1 遍: 累计 sub3Total
        final Map<Long, Integer> sub3Total = new HashMap<>();
        for (final DirectDamageEvent ev : events) {
            sub3Total.merge(ev.victimAccountId(), ev.damage(), Integer::sum);
        }

        // 第 2 遍: 找首次超阈值时刻
        final Map<Long, Integer> cumulative = new HashMap<>();
        final Map<Long, Double> result = new HashMap<>();
        // 预填充 0
        for (final Long acc : accountToThreshold.keySet()) {
            result.put(acc, 0.0);
        }
        for (final DirectDamageEvent ev : events) {
            final int prev = cumulative.getOrDefault(ev.victimAccountId(), 0);
            final int next = prev + ev.damage();
            cumulative.put(ev.victimAccountId(), next);
            // 该玩家死亡已找到?
            if (result.getOrDefault(ev.victimAccountId(), 0.0) > 0) continue;
            final Integer rcvThreshold = accountToThreshold.get(ev.victimAccountId());
            if (rcvThreshold == null || rcvThreshold <= 0) continue;
            // threshold = min(rcv, sub3Total) — sub3 可能无法覆盖全部受伤
            final int total = sub3Total.getOrDefault(ev.victimAccountId(), 0);
            final int threshold = Math.min(rcvThreshold, total);
            if (threshold > 0 && prev < threshold && next >= threshold) {
                result.put(ev.victimAccountId(), Math.min((double) ev.clockSecs(), battleDurationS));
            }
        }
        return result;
    }

    public static List<DirectDamageEvent> extractDirectDamageEvents(
            final List<ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount) {
        final List<DirectDamageEvent> events = new ArrayList<>();
        for (final ParsedPacket packet : packets) {
            final DirectDamageEvent event = parseDirectDamageEvent(packet, entityToAccount);
            if (event != null) {
                events.add(event);
            }
        }
        return events;
    }

    public static Map<Long, List<KillVictimDamage>> extractKillVictims(
            final List<ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount,
            final Map<Long, Integer> accountToThreshold) {
        final List<DirectDamageEvent> events = extractDirectDamageEvents(packets, entityToAccount);
        events.sort(Comparator.comparingDouble(DirectDamageEvent::clockSecs));

        final Map<Long, Integer> directTotalByVictim = new HashMap<>();
        for (final DirectDamageEvent event : events) {
            directTotalByVictim.merge(event.victimAccountId(), event.damage(), Integer::sum);
        }

        final Map<Long, Integer> cumulativeByVictim = new HashMap<>();
        final Map<DamagePair, DamageBucket> damageByPair = new HashMap<>();
        final Map<Long, List<KillVictimDamage>> victimsByKiller = new HashMap<>();
        final Set<Long> completedVictims = new HashSet<>();
        for (final DirectDamageEvent event : events) {
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
                    .add(new KillVictimDamage(killerAccountId, victimAccountId,
                            bucket.damage, bucket.penetrations));
        }
        return victimsByKiller;
    }

    private static DirectDamageEvent parseDirectDamageEvent(
            final ParsedPacket packet,
            final Map<Integer, Long> entityToAccount) {
        if (packet.type != TYPE_ENTITY_METHOD || packet.payload.length < 12) {
            return null;
        }
        if (readU32LE(packet.payload, 4) != SUBTYPE_ENTITY_METHOD_DAMAGE) {
            return null;
        }
        final byte[] body = new byte[packet.payload.length - 8];
        System.arraycopy(packet.payload, 8, body, 0, body.length);
        if (body.length != 25 || (body[13] & 0xFF) != DAMAGE_SUB_DIRECT) {
            return null;
        }

        final int attackerEid = readI32LE(body, 4);
        final int victimEid = readI32LE(body, 8);
        final Long attackerAccountId = entityToAccount.get(attackerEid);
        final Long victimAccountId = entityToAccount.get(victimEid);
        if (attackerAccountId == null || victimAccountId == null) {
            return null;
        }
        final int damage = (body[14] & 0xFF) << 8 | (body[15] & 0xFF);
        if (damage <= 0) {
            return null;
        }
        return new DirectDamageEvent(packet.clockSecs, attackerAccountId, victimAccountId, damage);
    }

    private record DamagePair(long attackerAccountId, long victimAccountId) {
    }

    private static final class DamageBucket {
        private int damage;
        private int penetrations;
    }

    // ---- EntityMethod 解析 ----

    public static List<ArenaSnapshot> extractArenaSnapshots(List<ParsedPacket> packets) {
        final List<ArenaSnapshot> snapshots = new ArrayList<>();
        for (final ParsedPacket pkt : packets) {
            if (pkt.type != TYPE_ENTITY_METHOD) {
                continue;
            }
            final EntityMethodResult em = parseEntityMethod(pkt.payload);
            if (em == null || em.subType != SUBTYPE_UPDATE_ARENA) {
                continue;
            }
            final ArenaSnapshot snap = parseUpdateArena(em.innerPayload, pkt.clockSecs);
            if (snap != null) {
                snapshots.add(snap);
            }
        }
        return snapshots;
    }

    public static double estimateDeathTime(
            long accountId, boolean survived, double battleDurationS,
            List<ArenaSnapshot> snapshots) {
        if (survived) {
            return battleDurationS;
        }
        if (snapshots.isEmpty()) {
            return 0;
        }
        double lastSeen = -1;
        for (final ArenaSnapshot snap : snapshots) {
            if (snap.accountIds.contains(accountId)) {
                lastSeen = snap.clockSecs;
            }
        }
        if (lastSeen > 0 && lastSeen < battleDurationS) {
            return lastSeen;
        }
        return 0;
    }

    // ---- 解析工具 ----

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
        final int subType = readU32LE(raw, i);
        i += 4;
        if (subType != SUBTYPE_UPDATE_ARENA) {
            return new EntityMethodResult(subType, null);
        }
        if (i + 4 > raw.length) {
            return new EntityMethodResult(subType, null);
        }
        i += 4;
        final long[] varRes = readVarint(raw, i);
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
            return readU16LE(buf, i + 1);
        }
        return first;
    }

    private static ArenaSnapshot parseUpdateArena(byte[] inner, float clockSecs) {
        final Map<Integer, List<Object>> updateArena = Protobuf.decode(inner);
        final Object playersRaw = Protobuf.first(updateArena, 1);
        if (!(playersRaw instanceof byte[])) {
            return null;
        }
        final Map<Integer, List<Object>> playersMsg = Protobuf.decode((byte[]) playersRaw);
        final List<Object> playerList = playersMsg.get(1);
        if (playerList == null) {
            return new ArenaSnapshot(clockSecs, new HashSet<>());
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
        return new ArenaSnapshot(clockSecs, accountIds);
    }

    // ---- 二进制读取 ----

    private static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    private static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static int readU16LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }

    private static String readLenPrefixedStr(byte[] buf, int i) {
        final int len = buf[i] & 0xFF;
        return new String(buf, i + 1, len, StandardCharsets.UTF_8);
    }

    private static long[] readVarint(byte[] buf, int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (true) {
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                break;
            }
            shift += 7;
        }
        return new long[]{result, idx};
    }
}
