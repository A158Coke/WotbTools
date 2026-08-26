package com.wotb.core.replay.processing;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 单场回放的实体到参战玩家映射。
 *
 * @param entitiesById entityId → 玩家身份
 * @param entityIdsByAccount accountId → 该账号在事件流出现过的实体 ID（支持 re-entry）
 * @param ambiguousEntityCount 因冲突而拒绝归因的实体数量
 * @param limitations 稳定英文限制码
 */
public record TeamEntityMapping(
        Map<Integer, TeamEntityIdentity> entitiesById,
        Map<Long, List<Integer>> entityIdsByAccount,
        Map<String, List<Integer>> entityIdsByNickname,
        int ambiguousEntityCount,
        List<String> limitations
) {

    public TeamEntityMapping {
        entitiesById = entitiesById == null
                ? Map.of() : Map.copyOf(new LinkedHashMap<>(entitiesById));
        if (entityIdsByAccount == null) {
            entityIdsByAccount = Map.of();
        } else {
            final Map<Long, List<Integer>> copy = new LinkedHashMap<>();
            entityIdsByAccount.forEach((accountId, entityIds) ->
                    copy.put(accountId, entityIds == null ? List.of() : List.copyOf(entityIds)));
            entityIdsByAccount = Map.copyOf(copy);
        }
        if (entityIdsByNickname == null) {
            entityIdsByNickname = Map.of();
        } else {
            final Map<String, List<Integer>> copy = new LinkedHashMap<>();
            entityIdsByNickname.forEach((nickname, entityIds) ->
                    copy.put(nickname, entityIds == null ? List.of() : List.copyOf(entityIds)));
            entityIdsByNickname = Map.copyOf(copy);
        }
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }

    public TeamEntityMapping(
            final Map<Integer, TeamEntityIdentity> entitiesById,
            final Map<Long, List<Integer>> entityIdsByAccount,
            final int ambiguousEntityCount,
            final List<String> limitations
    ) {
        this(entitiesById, entityIdsByAccount, Map.of(),
                ambiguousEntityCount, limitations);
    }

    public TeamEntityIdentity identity(final int entityId) {
        return entitiesById.get(entityId);
    }

    public List<Integer> entityIds(final long accountId) {
        return entityIdsByAccount.getOrDefault(accountId, List.of());
    }

    public List<Integer> entityIds(
            final long accountId,
            final String nickname
    ) {
        if (accountId > 0) {
            return entityIds(accountId);
        }
        return entityIdsByNickname.getOrDefault(nickname, List.of());
    }

    public int mappedMembers(final int team) {
        return (int) entitiesById.values().stream()
                .filter(TeamEntityIdentity::usable)
                .filter(identity -> identity.team() == team)
                .map(identity -> identity.accountId() > 0
                        ? "account:" + identity.accountId()
                        : "nickname:" + identity.nickname())
                .distinct()
                .count();
    }

    /**
     * ActualCombatantEntitySet：可靠映射到 #301 actual combatant account 的实体集合
     * （tactical FrameVehicle universe 的唯一来源）。
     * <p>即使 broad roster / ParticipantMapping 给实体提供了完整身份（accountId / team / nickname /
     * 坦克元数据），只要 account 不在 #301（battle.players），该实体仍不是 actual combatant，
     * 必须从 tactical timeline 排除（spectator ≠ combatant，battle_results #301 是权威边界）。</p>
     *
     * @param actualCombatantAccounts #301 actual combatant 账号集（battle.players 中 accountId > 0）
     * @return 属于 ActualCombatantEntitySet 的实体 ID 集合
     */
    public Set<Integer> actualCombatantEntityIds(final Set<Long> actualCombatantAccounts) {
        if (actualCombatantAccounts == null || actualCombatantAccounts.isEmpty()) {
            return Set.of();
        }
        final Set<Integer> out = new LinkedHashSet<>();
        entitiesById.forEach((entityId, identity) -> {
            if (identity.usable() && identity.accountId() > 0
                    && actualCombatantAccounts.contains(identity.accountId())) {
                out.add(entityId);
            }
        });
        return out;
    }
}
