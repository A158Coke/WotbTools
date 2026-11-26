package com.wotb.web.tournament.service;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

class TournamentDraftGroupSupport {
    private final TournamentEvidenceRepository evidence;
    private final TournamentClanRepository clans;

    TournamentDraftGroupSupport(final TournamentEvidenceRepository evidence, final TournamentClanRepository clans) {
        this.evidence = evidence; this.clans = clans;
    }
    List<TournamentSnapshot.Group> merge(final TournamentEvent event, final TournamentDay day, final TournamentRule rule, final TournamentDtos.DraftRequest request) {
        if (request.groups() == null || request.confirmedNewClans() == null || request.groups().size() > 10000) { throw TournamentService.invalid(); }
        final Map<Integer, TournamentSnapshot.Group> merged = new LinkedHashMap<>();
        if (day.draftGroups != null) { day.draftGroups.forEach(group -> merged.put(group.groupNumber(), group)); }
        final Set<Integer> incomingNumbers = new HashSet<>();
        for (final TournamentDtos.IncomingGroup incoming : request.groups()) {
            if (incoming == null || incoming.groupNumber() < 1 || incoming.groupNumber() > 10000 || !incomingNumbers.add(incoming.groupNumber()) || incoming.duplicateAction() == null || !Set.of("ERROR", "REPLACE", "SKIP").contains(incoming.duplicateAction())) { throw TournamentService.invalid(); }
            if (merged.containsKey(incoming.groupNumber())) {
                if ("SKIP".equals(incoming.duplicateAction())) { continue; }
                if ("ERROR".equals(incoming.duplicateAction())) { throw new ApiException(ApiErrorCode.TOURNAMENT_DUPLICATE_GROUP, null, Map.of("groupNumber", incoming.groupNumber())); }
            }
            if (!incoming.complete() || incoming.teams() == null || incoming.teams().size() < 3 || incoming.teams().size() > 5 || incoming.evidenceId() == null) { throw TournamentService.invalid(); }
            final TournamentEvidence attachment = evidence.findByIdAndEventId(incoming.evidenceId(), event.id).orElseThrow(() -> TournamentService.error(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID));
            if (attachment.roundNumber != day.roundNumber || attachment.dayNumber != day.dayNumber || !Objects.equals(attachment.imageHash, incoming.imageHash()) || (day.correction && attachment.createdAt.isBefore(day.correctionStartedAt))) { throw TournamentService.error(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID); }
            final List<TournamentSnapshot.Team> teams = incoming.teams().stream().map(team -> {
                if (team == null) { throw TournamentService.invalid(); } return new TournamentSnapshot.Team(TournamentService.clanTag(team.clanTag()), team.rank());
            }).sorted(Comparator.comparingInt(TournamentSnapshot.Team::rank)).toList();
            for (int index = 0; index < teams.size(); index++) { if (teams.get(index).rank() != index + 1) { throw TournamentService.invalid(); } }
            merged.put(incoming.groupNumber(), new TournamentSnapshot.Group(incoming.groupNumber(), attachment.id, attachment.imageHash, teams));
        }
        final List<TournamentSnapshot.Group> result = merged.values().stream().sorted(Comparator.comparingInt(TournamentSnapshot.Group::groupNumber)).toList();
        if (result.size() > day.expectedGroupCount) { throw TournamentService.error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); }
        validateSnapshot(result); validateRanksAgainstRules(result, rule, day.dayNumber);
        final Set<String> known = clans.findByEventIdOrderByClanTag(event.id).stream().map(clan -> clan.clanTag).collect(Collectors.toSet());
        final Set<String> confirmed = request.confirmedNewClans().stream().map(TournamentService::clanTag).collect(Collectors.toSet());
        final List<String> missing = TournamentService.tags(result).stream().filter(tag -> !known.contains(tag) && !confirmed.contains(tag)).sorted().toList();
        if (!missing.isEmpty()) { throw new ApiException(ApiErrorCode.TOURNAMENT_NEW_CLAN_CONFIRMATION_REQUIRED, null, Map.of("clanTags", missing)); }
        return result;
    }
    void validateSnapshot(final List<TournamentSnapshot.Group> groups) {
        final Set<String> seen = new HashSet<>(); final Set<String> hashes = new HashSet<>();
        for (final TournamentSnapshot.Group group : groups) {
            if (!hashes.add(group.imageHash())) { throw new ApiException(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, null, Map.of("groupNumber", group.groupNumber())); }
            for (final TournamentSnapshot.Team team : group.teams()) {
                if (!seen.add(team.clanTag())) { throw new ApiException(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, null, Map.of("clanTag", team.clanTag(), "groupNumber", group.groupNumber())); }
            }
        }
    }
    void validateRanksAgainstRules(final List<TournamentSnapshot.Group> groups, final TournamentRule rule, final int number) {
        final Map<Integer, Integer> points = TournamentRuleSupport.rulePoints(rule, number);
        for (final TournamentSnapshot.Group group : groups) {
            for (final TournamentSnapshot.Team team : group.teams()) {
                if (!points.containsKey(team.rank())) { throw new ApiException(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE, null, Map.of("dayNumber", number, "rank", team.rank())); }
            }
        }
    }
}
