package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 构建可复用的 entityId → participant → team 映射。
 * 不按 entityId 数值范围猜测队伍；冲突实体会被整体排除。
 */
public final class TeamEntityMapper {

    private TeamEntityMapper() {
    }

    public static TeamEntityMapping resolve(
            final Battle battle,
            final ReplayReconstruction reconstruction
    ) {
        if (reconstruction == null || reconstruction.events() == null) {
            return new TeamEntityMapping(
                    Map.of(), Map.of(), Map.of(), 0,
                    List.of("TEAM_ENTITY_MAPPING_UNAVAILABLE"));
        }

        final Map<Long, PlayerResult> playersByAccount = playersByAccount(battle);
        final Map<String, PlayerResult> uniquePlayersByNickname = uniquePlayersByNickname(battle);
        final Map<Long, BattleParticipant> participantsByAccount = participantsByAccount(reconstruction);
        final Map<String, BattleParticipant> uniqueParticipantsByNickname =
                uniqueParticipantsByNickname(reconstruction);
        final Map<Integer, TeamEntityIdentity> entities = new LinkedHashMap<>();
        final Map<Long, Set<Integer>> entityIdsByAccount = new LinkedHashMap<>();
        final Map<String, Set<Integer>> entityIdsByNickname = new LinkedHashMap<>();
        final Set<Integer> ambiguousEntities = new LinkedHashSet<>();
        final List<String> limitations = new ArrayList<>();

        final List<ParticipantMappingEvent> mappings = reconstruction.events().stream()
                .filter(ParticipantMappingEvent.class::isInstance)
                .map(ParticipantMappingEvent.class::cast)
                .sorted(Comparator.comparingInt(ParticipantMappingEvent::sequence))
                .toList();

        for (final ParticipantMappingEvent mapping : mappings) {
            if (mapping.entityId() <= 0
                    || mapping.accountId() <= 0
                    && !StringUtils.hasText(mapping.nickname())) {
                continue;
            }
            final TeamEntityIdentity identity = resolveIdentity(
                    mapping, playersByAccount, uniquePlayersByNickname,
                    participantsByAccount, uniqueParticipantsByNickname);
            if (identity == null || !identity.usable()) {
                continue;
            }
            final TeamEntityIdentity previous = entities.get(mapping.entityId());
            if (previous != null && !sameIdentity(previous, identity)) {
                entities.remove(mapping.entityId());
                removeEntityIndex(
                        entityIdsByAccount, previous.accountId(), mapping.entityId());
                removeEntityIndex(
                        entityIdsByNickname, previous.nickname(), mapping.entityId());
                ambiguousEntities.add(mapping.entityId());
                continue;
            }
            if (!ambiguousEntities.contains(mapping.entityId())) {
                if (previous != null
                        && !Objects.equals(
                                previous.nickname(), identity.nickname())) {
                    removeEntityIndex(
                            entityIdsByNickname,
                            previous.nickname(),
                            mapping.entityId());
                }
                entities.put(mapping.entityId(), identity);
                if (identity.accountId() > 0) {
                    entityIdsByAccount
                            .computeIfAbsent(
                                    identity.accountId(), ignored -> new LinkedHashSet<>())
                            .add(identity.entityId());
                }
                if (StringUtils.hasText(identity.nickname())) {
                    entityIdsByNickname
                            .computeIfAbsent(
                                    identity.nickname(), ignored -> new LinkedHashSet<>())
                            .add(identity.entityId());
                }
            }
        }

        if (!ambiguousEntities.isEmpty()) {
            limitations.add("TEAM_ENTITY_MAPPING_CONFLICT");
        }
        if (entities.isEmpty()) {
            limitations.add("TEAM_ENTITY_MAPPING_INSUFFICIENT");
        }
        final Map<Long, List<Integer>> immutableIds = new LinkedHashMap<>();
        entityIdsByAccount.forEach((accountId, entityIds) ->
                immutableIds.put(accountId, entityIds.stream().sorted().toList()));
        final Map<String, List<Integer>> immutableNicknameIds = new LinkedHashMap<>();
        entityIdsByNickname.forEach((nickname, entityIds) ->
                immutableNicknameIds.put(nickname, entityIds.stream().sorted().toList()));
        return new TeamEntityMapping(
                entities, immutableIds, immutableNicknameIds,
                ambiguousEntities.size(), limitations);
    }

    private static TeamEntityIdentity resolveIdentity(
            final ParticipantMappingEvent mapping,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<String, PlayerResult> uniquePlayersByNickname,
            final Map<Long, BattleParticipant> participantsByAccount,
            final Map<String, BattleParticipant> uniqueParticipantsByNickname
    ) {
        final PlayerResult authoritative = playersByAccount.get(mapping.accountId());
        final BattleParticipant participant = participantsByAccount.get(mapping.accountId());
        if (authoritative != null && authoritative.team > 0) {
            return new TeamEntityIdentity(
                    mapping.entityId(),
                    authoritative.accountId,
                    authoritative.nickname,
                    authoritative.tankId,
                    authoritative.tankName,
                    authoritative.team,
                    reliableConfidence(mapping.confidence(), DecodeConfidence.EXACT));
        }
        if (participant == null || participant.team() <= 0) {
            return resolveByMappingNickname(
                    mapping, uniquePlayersByNickname, uniqueParticipantsByNickname);
        }
        if (!isVehicleParticipant(participant)) {
            return null;
        }

        final PlayerResult nicknameMatch = StringUtils.hasText(participant.nickname())
                ? uniquePlayersByNickname.get(participant.nickname()) : null;
        if (nicknameMatch != null && nicknameMatch.team > 0) {
            return new TeamEntityIdentity(
                    mapping.entityId(),
                    nicknameMatch.accountId,
                    nicknameMatch.nickname,
                    nicknameMatch.tankId,
                    nicknameMatch.tankName,
                    nicknameMatch.team,
                    reliableConfidence(mapping.confidence(), DecodeConfidence.INFERRED));
        }
        return new TeamEntityIdentity(
                mapping.entityId(),
                participant.accountId(),
                participant.nickname(),
                participant.tankId(),
                participant.tankCode(),
                participant.team(),
                reliableConfidence(mapping.confidence(), DecodeConfidence.EXACT));
    }

    private static TeamEntityIdentity resolveByMappingNickname(
            final ParticipantMappingEvent mapping,
            final Map<String, PlayerResult> uniquePlayersByNickname,
            final Map<String, BattleParticipant> uniqueParticipantsByNickname
    ) {
        if (!StringUtils.hasText(mapping.nickname())) {
            return null;
        }
        final PlayerResult authoritative =
                uniquePlayersByNickname.get(mapping.nickname());
        final BattleParticipant participant =
                uniqueParticipantsByNickname.get(mapping.nickname());
        if (participant != null
                && (participant.team() <= 0 || !isVehicleParticipant(participant))) {
            return null;
        }
        if (authoritative != null && authoritative.team > 0
                && (isVehiclePlayer(authoritative) || participant != null)) {
            if (participant != null && participant.team() != authoritative.team) {
                return null;
            }
            return new TeamEntityIdentity(
                    mapping.entityId(),
                    authoritative.accountId,
                    authoritative.nickname,
                    authoritative.tankId,
                    authoritative.tankName,
                    authoritative.team,
                    reliableConfidence(mapping.confidence(), DecodeConfidence.INFERRED));
        }
        if (participant == null) {
            return null;
        }
        final int team = mapping.team() > 0 ? mapping.team() : participant.team();
        if (mapping.team() > 0 && mapping.team() != participant.team()) {
            return null;
        }
        return new TeamEntityIdentity(
                mapping.entityId(),
                participant.accountId(),
                participant.nickname(),
                participant.tankId(),
                participant.tankCode(),
                team,
                reliableConfidence(mapping.confidence(), DecodeConfidence.INFERRED));
    }

    private static boolean isVehicleParticipant(
            final BattleParticipant participant
    ) {
        return participant.tankId() > 0
                || StringUtils.hasText(participant.tankCode());
    }

    private static boolean isVehiclePlayer(final PlayerResult player) {
        return player.tankId > 0 || StringUtils.hasText(player.tankName);
    }

    private static boolean sameIdentity(
            final TeamEntityIdentity left,
            final TeamEntityIdentity right
    ) {
        if (left.accountId() > 0 && right.accountId() > 0) {
            return left.accountId() == right.accountId();
        }
        return left.team() == right.team()
                && StringUtils.hasText(left.nickname())
                && left.nickname().equals(right.nickname());
    }

    private static <K> void removeEntityIndex(
            final Map<K, Set<Integer>> index,
            final K key,
            final int entityId
    ) {
        final Set<Integer> entityIds = index.get(key);
        if (entityIds == null) {
            return;
        }
        entityIds.remove(entityId);
        if (entityIds.isEmpty()) {
            index.remove(key);
        }
    }

    private static DecodeConfidence reliableConfidence(
            final DecodeConfidence mappingConfidence,
            final DecodeConfidence identityConfidence
    ) {
        final DecodeConfidence mapping = mappingConfidence == null
                ? DecodeConfidence.UNKNOWN : mappingConfidence;
        if (mapping == DecodeConfidence.UNKNOWN
                || identityConfidence == DecodeConfidence.UNKNOWN) {
            return DecodeConfidence.UNKNOWN;
        }
        if (mapping == DecodeConfidence.PARTIAL
                || identityConfidence == DecodeConfidence.PARTIAL) {
            return DecodeConfidence.PARTIAL;
        }
        if (mapping == DecodeConfidence.INFERRED
                || identityConfidence == DecodeConfidence.INFERRED) {
            return DecodeConfidence.INFERRED;
        }
        return DecodeConfidence.EXACT;
    }

    private static Map<Long, PlayerResult> playersByAccount(final Battle battle) {
        final Map<Long, PlayerResult> result = new HashMap<>();
        if (battle == null || battle.players == null) {
            return result;
        }
        battle.players.stream()
                .filter(player -> player.accountId > 0)
                .forEach(player -> result.putIfAbsent(player.accountId, player));
        return result;
    }

    private static Map<String, PlayerResult> uniquePlayersByNickname(final Battle battle) {
        final Map<String, PlayerResult> unique = new HashMap<>();
        final Set<String> duplicates = new LinkedHashSet<>();
        if (battle == null || battle.players == null) {
            return unique;
        }
        for (final PlayerResult player : battle.players) {
            if (!StringUtils.hasText(player.nickname)) {
                continue;
            }
            if (unique.putIfAbsent(player.nickname, player) != null) {
                duplicates.add(player.nickname);
            }
        }
        duplicates.forEach(unique::remove);
        return unique;
    }

    private static Map<Long, BattleParticipant> participantsByAccount(
            final ReplayReconstruction reconstruction
    ) {
        final Map<Long, BattleParticipant> result = new HashMap<>();
        if (reconstruction.participants() == null) {
            return result;
        }
        reconstruction.participants().stream()
                .filter(participant -> participant.accountId() > 0)
                .forEach(participant -> result.putIfAbsent(participant.accountId(), participant));
        return result;
    }

    private static Map<String, BattleParticipant> uniqueParticipantsByNickname(
            final ReplayReconstruction reconstruction
    ) {
        final Map<String, BattleParticipant> unique = new HashMap<>();
        final Set<String> duplicates = new LinkedHashSet<>();
        if (reconstruction.participants() == null) {
            return unique;
        }
        for (final BattleParticipant participant : reconstruction.participants()) {
            if (!StringUtils.hasText(participant.nickname())) {
                continue;
            }
            if (unique.putIfAbsent(participant.nickname(), participant) != null) {
                duplicates.add(participant.nickname());
            }
        }
        duplicates.forEach(unique::remove);
        return unique;
    }
}
