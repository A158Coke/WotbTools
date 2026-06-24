package com.wotb.core.parse;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
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
    private static final int MAX_PAYLOAD_LEN = 200_000;
    private static final float MAX_SANE_CLOCK = 5000f;

    private EventStreamReader() {
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
