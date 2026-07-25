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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 统一解析训练房/联赛回放的 {@code perspectiveTeam}。
 * 权威结算优先，重建数据只补充录像者身份和实体映射；证据冲突时拒绝猜测。
 */
public final class TeamPerspectiveResolver {

    private TeamPerspectiveResolver() {
    }

    public static TeamPerspectiveResolution resolve(
            final Battle battle,
            final ReplayReconstruction reconstruction
    ) {
        final Set<Integer> teams = new LinkedHashSet<>();
        final Set<Long> recorderAccounts = new LinkedHashSet<>();
        final List<String> limitations = new ArrayList<>();
        DecodeConfidence confidence = DecodeConfidence.UNKNOWN;
        boolean authoritativeTeamMatch = false;
        boolean participantMatch = false;
        boolean nicknameFallback = false;

        final String recorderNickname = battle != null ? battle.recorder : null;
        if (battle != null && battle.players != null && StringUtils.hasText(recorderNickname)) {
            final List<PlayerResult> matches = battle.players.stream()
                    .filter(player -> recorderNickname.equals(player.nickname))
                    .toList();
            if (matches.size() > 1) {
                limitations.add("RECORDER_NICKNAME_AMBIGUOUS");
            }
            for (final PlayerResult player : matches) {
                addValidTeam(teams, player.team);
                if (player.accountId > 0) {
                    recorderAccounts.add(player.accountId);
                }
                if (player.team > 0) {
                    authoritativeTeamMatch = true;
                }
            }
        }

        final List<BattleParticipant> participants = reconstruction != null
                && reconstruction.participants() != null
                ? reconstruction.participants() : List.of();
        for (final BattleParticipant participant : participants) {
            final boolean accountMatch = participant.accountId() > 0
                    && recorderAccounts.contains(participant.accountId());
            final boolean markedRecorder = participant.recorder();
            final boolean nicknameMatch = StringUtils.hasText(recorderNickname)
                    && recorderNickname.equals(participant.nickname());
            if (!accountMatch && !markedRecorder && !nicknameMatch) {
                continue;
            }
            if (!isVehicleParticipant(participant)) {
                continue;
            }
            addValidTeam(teams, participant.team());
            if (participant.team() > 0) {
                participantMatch = true;
            }
            if (participant.accountId() > 0) {
                recorderAccounts.add(participant.accountId());
            }
            if (!accountMatch && !markedRecorder && nicknameMatch) {
                nicknameFallback = true;
            }
        }

        if (recorderAccounts.size() > 1) {
            limitations.add("RECORDER_IDENTITY_CONFLICT");
            return new TeamPerspectiveResolution(
                    null, null, null, DecodeConfidence.UNKNOWN, limitations);
        }
        if (teams.size() > 1) {
            limitations.add("PERSPECTIVE_TEAM_CONFLICT");
            return new TeamPerspectiveResolution(
                    null, recorderAccounts.stream().findFirst().orElse(null),
                    null, DecodeConfidence.UNKNOWN, limitations);
        }
        if (teams.isEmpty()) {
            limitations.add("PERSPECTIVE_TEAM_UNRESOLVED");
            return new TeamPerspectiveResolution(
                    null, recorderAccounts.stream().findFirst().orElse(null),
                    null, DecodeConfidence.UNKNOWN, limitations);
        }

        final Long recorderAccountId = recorderAccounts.stream().findFirst().orElse(null);
        final Integer recorderEntityId = resolveLatestEntityId(
                reconstruction, recorderAccountId, recorderNickname, limitations);
        if (authoritativeTeamMatch) {
            confidence = DecodeConfidence.EXACT;
        } else if (participantMatch) {
            confidence = DecodeConfidence.INFERRED;
        }
        if (nicknameFallback) {
            limitations.add("RECORDER_MATCHED_BY_NICKNAME");
        }
        if (recorderEntityId == null) {
            limitations.add("RECORDER_ENTITY_UNMAPPED");
        }

        return new TeamPerspectiveResolution(
                teams.iterator().next(),
                recorderAccountId,
                recorderEntityId,
                confidence,
                limitations);
    }

    private static void addValidTeam(final Set<Integer> teams, final int team) {
        if (team > 0) {
            teams.add(team);
        }
    }

    private static boolean isVehicleParticipant(
            final BattleParticipant participant
    ) {
        return participant.tankId() > 0
                || StringUtils.hasText(participant.tankCode());
    }

    private static Integer resolveLatestEntityId(
            final ReplayReconstruction reconstruction,
            final Long recorderAccountId,
            final String recorderNickname,
            final List<String> limitations
    ) {
        if (reconstruction == null || reconstruction.events() == null
                || recorderAccountId == null
                && !StringUtils.hasText(recorderNickname)) {
            return null;
        }
        final List<ParticipantMappingEvent> mappings = reconstruction.events().stream()
                .filter(ParticipantMappingEvent.class::isInstance)
                .map(ParticipantMappingEvent.class::cast)
                .filter(event -> event.entityId() > 0)
                .filter(event -> recorderAccountId != null
                        ? event.accountId() == recorderAccountId
                        : recorderNickname.equals(event.nickname()))
                .filter(event -> event.confidence() == DecodeConfidence.EXACT
                        || event.confidence() == DecodeConfidence.INFERRED)
                .sorted(Comparator.comparingInt(ParticipantMappingEvent::sequence))
                .toList();
        if (mappings.size() > 1
                && mappings.stream().map(ParticipantMappingEvent::entityId).distinct().count() > 1) {
            limitations.add("RECORDER_ENTITY_REENTRY");
        }
        return mappings.isEmpty() ? null : mappings.getLast().entityId();
    }
}
