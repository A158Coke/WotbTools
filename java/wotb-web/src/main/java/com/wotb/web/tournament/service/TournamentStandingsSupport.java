package com.wotb.web.tournament.service;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

class TournamentStandingsSupport {
    private final TournamentDayRepository days;
    private final TournamentClanRepository clans;
    private final TournamentMapper mapper;
    private final TournamentRuleSupport ruleSupport;

    TournamentStandingsSupport(final TournamentDayRepository days, final TournamentClanRepository clans,
                               final TournamentMapper mapper, final TournamentRuleSupport ruleSupport) {
        this.days = days; this.clans = clans; this.mapper = mapper; this.ruleSupport = ruleSupport;
    }
    private List<TournamentDay> dayList(final long id) { return days.findByEventIdOrderByRoundNumberAscDayNumberAsc(id); }
    TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin) {
        return standings(event, storedDays, previewDay, preview, admin, Set.of());
    }
    TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin, final Set<String> historicalRoster) {
        return standings(event, storedDays, previewDay, preview, admin, historicalRoster, false);
    }
    TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin, final Set<String> historicalRoster, final boolean replaceRoster) {
        return standings(event, storedDays, previewDay, preview, admin, historicalRoster, replaceRoster, true);
    }
    TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin, final Set<String> historicalRoster, final boolean replaceRoster, final boolean applyClears) {
        final Map<String, Map<String, Long>> scores = new HashMap<>();
        clans.findByEventIdOrderByClanTag(event.id).stream().filter(clan -> !replaceRoster && clan.historicalPublished)
                .forEach(clan -> scores.put(clan.clanTag, new HashMap<>()));
        historicalRoster.forEach(tag -> scores.putIfAbsent(tag, new HashMap<>()));
        final Map<String, TournamentDay> dayByKey = storedDays.stream().collect(Collectors.toMap(day -> TournamentService.key(day.roundNumber, day.dayNumber), day -> day));
        if (previewDay != null) { dayByKey.put(TournamentService.key(previewDay.roundNumber, previewDay.dayNumber), previewDay); }
        final List<TournamentDtos.StandingDay> columns = new ArrayList<>();
        final Map<Integer, TournamentRule> ruleByRound = ruleSupport.effectiveRules(event).stream().collect(Collectors.toMap(rule -> rule.roundNumber, rule -> rule));
        for (int round = 1; round <= event.roundCount; round++) {
            for (int number = 1; number <= event.daysPerRound; number++) {
                final String key = TournamentService.key(round, number); final TournamentDay day = dayByKey.get(key);
                columns.add(new TournamentDtos.StandingDay(round, number, event.dayLabels.get(number - 1), day != null && TournamentService.published(day)));
                if (day == null) { continue; }
                final List<TournamentSnapshot.Group> selected = previewDay == day && preview != null ? preview : admin && day.draftGroups != null ? day.draftGroups : day.publishedGroups;
                if (selected == null && day.publishedHistoricalPoints == null) { continue; }
                final Map<Integer, Integer> points = TournamentRuleSupport.rulePoints(ruleByRound.get(round), number);
                if (selected == null) {
                    day.publishedHistoricalPoints.forEach((tag, value) -> scores.computeIfAbsent(tag, ignored -> new HashMap<>()).put(key, applyClears && day.clearedClans.contains(tag) ? 0L : value.longValue()));
                }
                for (final TournamentSnapshot.Group group : selected == null ? List.<TournamentSnapshot.Group>of() : selected) {
                    for (final TournamentSnapshot.Team team : group.teams()) {
                        final Integer value = points.get(team.rank()); if (value == null) { throw TournamentService.error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE); }
                        scores.computeIfAbsent(team.clanTag(), ignored -> new HashMap<>()).put(key, applyClears && day.clearedClans.contains(team.clanTag()) ? 0L : value.longValue());
                    }
                }
                for (final String tag : applyClears ? day.clearedClans : Set.<String>of()) {
                    if ((!event.csvImported && !replaceRoster) || (selected != null && scores.containsKey(tag))) {
                        scores.computeIfAbsent(tag, ignored -> new HashMap<>()).put(key, 0L);
                    }
                }
            }
        }
        final List<TournamentDtos.StandingRow> rows = new ArrayList<>();
        for (final Map.Entry<String, Map<String, Long>> entry : scores.entrySet()) {
            long total = 0; final List<TournamentDtos.RoundPoints> roundPoints = new ArrayList<>();
            for (int round = 1; round <= event.roundCount; round++) {
                long roundTotal = 0; final List<TournamentDtos.DayPoints> values = new ArrayList<>();
                for (int number = 1; number <= event.daysPerRound; number++) {
                    final Long value = entry.getValue().get(TournamentService.key(round, number)); values.add(new TournamentDtos.DayPoints(number, value));
                    if (value != null) { roundTotal = Math.addExact(roundTotal, value); }
                }
                total = Math.addExact(total, roundTotal); roundPoints.add(new TournamentDtos.RoundPoints(round, roundTotal, values));
            }
            rows.add(new TournamentDtos.StandingRow(0, entry.getKey(), total, roundPoints));
        }
        rows.sort(Comparator.comparingLong(TournamentDtos.StandingRow::totalPoints).reversed().thenComparing(TournamentDtos.StandingRow::clanTag));
        final List<TournamentDtos.StandingRow> ranked = new ArrayList<>(); long previous = -1; int rank = 0;
        for (int index = 0; index < rows.size(); index++) {
            final TournamentDtos.StandingRow row = rows.get(index); if (row.totalPoints() != previous) { rank = index + 1; previous = row.totalPoints(); }
            ranked.add(new TournamentDtos.StandingRow(rank, row.clanTag(), row.totalPoints(), row.rounds()));
        }
        return new TournamentDtos.Standings(mapper.toDto(event), List.copyOf(columns), List.copyOf(ranked));
    }
    TournamentDtos.DayView dayView(final TournamentEvent event, final TournamentDay day, final List<TournamentSnapshot.Group> preview) {
        return dayView(event, day, preview, false);
    }
    TournamentDtos.DayView dayView(final TournamentEvent event, final TournamentDay day, final List<TournamentSnapshot.Group> preview, final boolean includeCanonicalStandings) {
        final List<TournamentSnapshot.Group> selected = preview != null ? preview : day.draftGroups != null ? day.draftGroups : day.publishedGroups != null ? day.publishedGroups : List.of();
        final String status = day.correction ? "CORRECTION" : TournamentService.published(day) ? "FINALIZED" : day.draftGroups != null || preview != null ? "DRAFT" : "EMPTY";
        return new TournamentDtos.DayView(event.id, day.roundNumber, day.dayNumber, event.version, ruleSupport.effectiveRules(event).stream().filter(rule -> rule.roundNumber == day.roundNumber).findFirst().orElseThrow().rulesVersion,
                day.version, status, day.expectedGroupCount, selected.stream().map(mapper::group).toList(), TournamentService.published(day),
                standings(event, dayList(event.id), preview == null ? null : day, preview, true),
                includeCanonicalStandings ? standings(event, dayList(event.id), null, null, false, Set.of(), false, false) : null);
    }
}
