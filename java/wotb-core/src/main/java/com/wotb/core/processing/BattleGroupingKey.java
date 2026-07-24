package com.wotb.core.processing;

import com.wotb.core.model.Battle;

/**
 * 规范化战斗分组键，用于 HashMap equals/hashCode。
 * <p>
 * 规范规则：
 * <ol>
 *   <li>arenaUniqueId 非空 → 仅用 arenaUniqueId，其他字段置 null</li>
 *   <li>arenaUniqueId 为空 + map/version/startEpoch 完整 → 用三者</li>
 *   <li>上述信息不完整 → 用 uniqueFallback（contentHash），宁可独立不错误合并</li>
 * </ol>
 * </p>
 */
public record BattleGroupingKey(
        String arenaUniqueId,
        String mapCode,
        String clientVersion,
        Long battleStartEpochSecond,
        String uniqueFallback
) {

    public static BattleGroupingKey from(final ReplayIdentity identity, final Battle battle, final String fileNameFallback) {
        if (identity == null) return fromBattleOrFile(battle, fileNameFallback);
        final String arenaId = blankToNull(identity.arenaUniqueId());
        if (arenaId != null) return new BattleGroupingKey(arenaId, null, null, null, null);
        // identity 无 arenaUniqueId 时降级到 Battle.arenaId
        if (battle != null) {
            final String battleArena = blankToNull(battle.arenaId);
            if (battleArena != null) return new BattleGroupingKey(battleArena, null, null, null, null);
        }
        final String map = blankToNull(identity.mapCode());
        final String clientVersion = blankToNull(identity.clientVersion());
        final Long startEpoch = identity.battleTime() != null ? identity.battleTime().getEpochSecond() : null;
        if (map != null && clientVersion != null && startEpoch != null)
            return new BattleGroupingKey(null, map, clientVersion, startEpoch, null);
        // 降级到 Battle.mapName
        if (battle != null) {
            final String battleMap = blankToNull(battle.mapName);
            if (battleMap != null) return new BattleGroupingKey(null, battleMap, null, null, null);
        }
        return new BattleGroupingKey(null, null, null, null, identity.contentHash());
    }

    private static BattleGroupingKey fromBattleOrFile(final Battle battle, final String fileNameFallback) {
        if (battle != null) {
            final String arenaId = blankToNull(battle.arenaId);
            if (arenaId != null) return new BattleGroupingKey(arenaId, null, null, null, null);
            final String map = blankToNull(battle.mapName);
            if (map != null) return new BattleGroupingKey(null, map, null, null, null);
        }
        return new BattleGroupingKey(null, null, null, null, fileNameFallback);
    }

    private static String blankToNull(final String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    /** 构建用于 API 显示（不含 uniqueFallback 的简洁版本）。 */
    public BattleIdentity toBattleIdentity() {
        return new BattleIdentity(
                arenaUniqueId,
                mapCode != null ? mapCode : "",
                clientVersion != null ? clientVersion : "",
                battleStartEpochSecond
        );
    }

    /** 用于 HashMap 的 equals/hashCode 基于 uniqueFallback 兜底。 */
    @Override
    public final boolean equals(final Object o) {
        if (this == o) return true;
        if (!(o instanceof BattleGroupingKey k)) return false;
        if (arenaUniqueId != null) return arenaUniqueId.equals(k.arenaUniqueId);
        if (k.arenaUniqueId != null) return false;
        if (uniqueFallback != null) return uniqueFallback.equals(k.uniqueFallback);
        if (k.uniqueFallback != null) return false;
        return true;
    }

    @Override
    public final int hashCode() {
        if (arenaUniqueId != null) return arenaUniqueId.hashCode();
        if (uniqueFallback != null) return uniqueFallback.hashCode();
        return 0;
    }
}
