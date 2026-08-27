package com.wotb.core.parse;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 解析 data.wotreplay 事件流。
 *
 * <p>包头: 魔数(4) + 未知(8) + hash(1+len) + version(1+len) + 1字节填充。
 * 后跟 N 个事件包: payload_len(4) + type(4) + clock(f32 4) + payload(len 字节)。
 *
 * <p>Strict contiguous framing（PR147）：包从头到尾连续排列，{@code payloadLen == 0} 合法，
 * 流以 {@code type == 0xFFFFFFFF} terminator 结束；framing corruption 直接抛异常，
 * 不做逐 byte resync。</p>
 */
public final class EventStreamReader {


    private EventStreamReader() {
    }

    /** One direct HP damage event resolved from replay entity ids to account ids. */
    public record DirectDamageEvent(float clockSecs, long attackerAccountId,
                                    long victimAccountId, int damage) {
    }

    /** Damage dealt by one attacker to one victim before the victim is inferred dead
     * （legacy/non-authoritative derived combat attribution，§B3；不得作为权威 kill evidence）。 */
    public record LegacyKillVictimDamage(long killerAccountId, long victimAccountId,
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

    /** Type 10 (Position) 解码结果（legacy diagnostics 用途）。 */
    public static final class PositionData {
        public final float clockSecs;
        public final int entityId;
        public final int spaceId;
        public final int attachmentParentEntityId;
        public final float x, y, z;
        public final float yaw, pitch, roll;

        public PositionData(float clockSecs, int entityId, int spaceId, int attachmentParentEntityId,
                            float x, float y, float z, float yaw, float pitch, float roll) {
            this.clockSecs = clockSecs;
            this.entityId = entityId;
            this.spaceId = spaceId;
            this.attachmentParentEntityId = attachmentParentEntityId;
            this.x = x;
            this.y = y;
            this.z = z;
            this.yaw = yaw;
            this.pitch = pitch;
            this.roll = roll;
        }
    }

    /**
     * Arena metadata decoded from the {@code basePlayerCreate} pickle
     * (authoritative roster, team labels and result flags at match start).
     */
    public record ArenaInfo(
            List<Long> accountDatabaseIds,
            Map<Integer, String> clanTags,
            Map<Integer, String> teamTitles,
            Map<Integer, Integer> wins,
            int battleLevel,
            int mmType,
            long webId) {
    }


    static final int MAX_PACKETS = ReplayPacketParser.MAX_PACKETS;

    // ===== forwarder：解析逻辑已拆至 ReplayPacketParser / ReplayEventExtractors / DeathTimeEstimator =====

    public static EventStream read(byte[] data) {
        return ReplayPacketParser.read(data);
    }

    public static List<EntityLeaveEvent> extractEntityLeaves(List<ParsedPacket> packets) {
        return ReplayEventExtractors.extractEntityLeaves(packets);
    }

    public static List<PositionData> extractPositions(List<ParsedPacket> packets) {
        return ReplayEventExtractors.extractPositions(packets);
    }

    public static double estimateDeathTimeByEntity(
            int entityId, double battleDurationS, List<EntityLeaveEvent> leaves) {
        return LegacyDeathHeuristicDiagnostics.estimateDeathTimeByEntity(
                entityId, battleDurationS, leaves);
    }

    public static Map<Integer, Long> extractEntityToAccountMap(List<ParsedPacket> packets) {
        return ReplayEventExtractors.extractEntityToAccountMap(packets);
    }

    public static ArenaInfo extractArenaInfo(List<ParsedPacket> packets) {
        return ReplayEventExtractors.extractArenaInfo(packets);
    }

    public static Map<Long, Double> estimateDeathTimesByEntityLeaves(
            List<ParsedPacket> packets, double battleDurationS) {
        return LegacyDeathHeuristicDiagnostics.estimateDeathTimesByEntityLeaves(
                packets, battleDurationS);
    }

    public static Map<Long, Double> estimateDeathTimesByPositions(
            List<ParsedPacket> packets, double battleDurationS) {
        return LegacyDeathHeuristicDiagnostics.estimateDeathTimesByPositions(
                packets, battleDurationS);
    }

    public static Map<Long, Double> estimateDeathTimesByDamage(
            final List<ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount,
            final Map<Long, Integer> accountToThreshold,
            final double battleDurationS) {
        return LegacyDeathHeuristicDiagnostics.estimateDeathTimesByDamage(
                packets, entityToAccount, accountToThreshold, battleDurationS);
    }

    public static List<DirectDamageEvent> extractDirectDamageEvents(
            final List<ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount) {
        return ReplayEventExtractors.extractDirectDamageEvents(packets, entityToAccount);
    }

    public static Map<Long, List<LegacyKillVictimDamage>> extractLegacyKillVictimAttribution(
            final List<ParsedPacket> packets,
            final Map<Integer, Long> entityToAccount,
            final Map<Long, Integer> accountToThreshold) {
        return ReplayEventExtractors.extractLegacyKillVictimAttribution(
                packets, entityToAccount, accountToThreshold);
    }

    public static List<ArenaSnapshot> extractArenaSnapshots(List<ParsedPacket> packets) {
        return ReplayEventExtractors.extractArenaSnapshots(packets);
    }

    public static double estimateDeathTime(
            long accountId, boolean survived, double battleDurationS,
            List<ArenaSnapshot> snapshots) {
        return LegacyDeathHeuristicDiagnostics.estimateDeathTime(
                accountId, survived, battleDurationS, snapshots);
    }

}
