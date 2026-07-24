package com.wotb.core.processing;

import com.wotb.core.model.Battle;

/**
 * 规范化战斗分组键。三种互斥模式，使用 record 默认 equals/hashCode。
 * <ul>
 *   <li>ARENA — arenaUniqueId 非空，仅用它，其他字段 null</li>
 *   <li>COMPOSITE — arena 缺失但 map+version+time 完整</li>
 *   <li>FALLBACK — 以上都不满足，用 contentHash 或请求内稳定 ID</li>
 * </ul>
 */
public record BattleGroupingKey(
        KeyType type,
        String arenaUniqueId,
        String mapCode,
        String clientVersion,
        Long battleStartEpochSecond,
        String uniqueFallback
) {

    public enum KeyType { ARENA, COMPOSITE, FALLBACK }

    public static BattleGroupingKey from(final ReplayIdentity identity, final Battle battle, final String requestFallback) {
        final String arenaId = firstNonBlank(
                identity != null ? blankToNull(identity.arenaUniqueId()) : null,
                battle != null ? blankToNull(battle.arenaId) : null
        );
        if (arenaId != null) return new BattleGroupingKey(KeyType.ARENA, arenaId, null, null, null, null);

        final String mapCode = firstNonBlank(
                identity != null ? blankToNull(identity.mapCode()) : null,
                battle != null ? blankToNull(battle.mapName) : null
        );
        final String clientVersion = identity != null ? blankToNull(identity.clientVersion()) : null;
        final Long startEpoch = identity != null && identity.battleTime() != null
                ? identity.battleTime().getEpochSecond() : null;

        if (mapCode != null && clientVersion != null && startEpoch != null)
            return new BattleGroupingKey(KeyType.COMPOSITE, null, mapCode, clientVersion, startEpoch, null);

        final String fallback = identity != null ? blankToNull(identity.contentHash()) : null;
        return new BattleGroupingKey(KeyType.FALLBACK, null, null, null, null,
                fallback != null ? fallback : requestFallback);
    }

    public BattleIdentity toBattleIdentity() {
        return new BattleIdentity(arenaUniqueId, mapCode != null ? mapCode : "",
                clientVersion != null ? clientVersion : "", battleStartEpochSecond);
    }

    private static String firstNonBlank(final String... values) {
        for (final String v : values) { if (v != null) return v; }
        return null;
    }

    private static String blankToNull(final String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
