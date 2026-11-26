package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Collectors;

final class TeamPositionEvidenceExtractor {
    private TeamPositionEvidenceExtractor() {
    }

    static Map<Integer, List<PositionChangedEvent>> teamPositionsByEntity(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent,
            final Predicate<PositionChangedEvent> usableSpatialEvidence
    ) {
        return events.stream()
                .filter(PositionChangedEvent.class::isInstance)
                .map(PositionChangedEvent.class::cast)
                .filter(position -> {
                    final TacticalTimeResolution res = resolutionByEvent.get(position);
                    return res != null && res.isUsable();
                })
                .filter(usableSpatialEvidence)
                .filter(position -> {
                    final TeamEntityIdentity identity = mapping.identity(position.entityId());
                    return identity != null && identity.usable()
                            && identity.team() == perspectiveTeam;
                })
                .collect(Collectors.groupingBy(
                        PositionChangedEvent::entityId,
                        LinkedHashMap::new,
                        Collectors.collectingAndThen(
                                Collectors.toList(),
                                list -> {
                                    list.sort(Comparator.comparingInt(PositionChangedEvent::sequence));
                                    return list;
                                })));
    }

    static PositionEvidenceAudit auditPositionEvidence(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final Map<ReplayEvent, TacticalTimeResolution> resolutionByEvent,
            final Battle battle,
            final Predicate<PositionChangedEvent> isOutOfBounds
    ) {
        final Set<Long> combatantAccounts = new LinkedHashSet<>();
        final Set<String> combatantNicknames = new LinkedHashSet<>();
        if (battle != null && battle.players != null) {
            for (final PlayerResult player : battle.players) {
                if (player == null) {
                    continue;
                }
                if (player.accountId > 0) {
                    combatantAccounts.add(player.accountId);
                }
                if (StringUtils.hasText(player.nickname)) {
                    combatantNicknames.add(player.nickname);
                }
            }
        }
        final Map<Integer, Long> accountByEntity = new HashMap<>();
        final Map<Integer, String> nicknameByEntity = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (event instanceof ParticipantMappingEvent pm) {
                if (pm.accountId() > 0) {
                    accountByEntity.putIfAbsent(pm.entityId(), pm.accountId());
                } else if (StringUtils.hasText(pm.nickname())) {
                    nicknameByEntity.putIfAbsent(pm.entityId(), pm.nickname());
                }
            }
        }
        int unattributedCombatantCount = 0;
        int nonCombatantPositionCount = 0;
        int outOfBoundsCount = 0;
        for (final ReplayEvent event : events) {
            if (!(event instanceof PositionChangedEvent position)) {
                continue;
            }
            final TacticalTimeResolution res = resolutionByEvent.get(event);
            if (res == null || !res.isUsable()) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(position.entityId());
            if (identity == null || !identity.usable()) {
                final Long mappedAccount = accountByEntity.get(position.entityId());
                final String mappedNickname = nicknameByEntity.get(position.entityId());
                final boolean combatantEntity = mappedAccount != null
                        && combatantAccounts.contains(mappedAccount)
                        || mappedNickname != null && combatantNicknames.contains(mappedNickname);
                if (combatantEntity) {
                    unattributedCombatantCount++;
                } else {
                    nonCombatantPositionCount++;
                }
                continue;
            }
            if (identity.team() != perspectiveTeam) {
                continue;
            }
            if (isOutOfBounds.test(position)) {
                outOfBoundsCount++;
            }
        }
        return new PositionEvidenceAudit(
                unattributedCombatantCount, nonCombatantPositionCount, outOfBoundsCount);
    }

    record PositionEvidenceAudit(
            int unattributedCombatantCount,
            int nonCombatantPositionCount,
            int outOfBoundsCount
    ) {
    }
}
