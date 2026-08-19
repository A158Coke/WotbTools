package com.wotb.core.processing;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 单场回放的实体到参战玩家映射。
 *
 * @param entitiesById         entityId → 玩家身份
 * @param entityIdsByAccount   accountId → 该账号在事件流出现过的实体 ID（支持 re-entry）
 * @param ambiguousEntityCount 因冲突而拒绝归因的实体数量
 * @param limitations          稳定英文限制码
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
}
