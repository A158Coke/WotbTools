package com.wotb.web.tournament.service;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentDefaultRules;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.repository.TournamentDefaultRulesRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import org.springframework.util.StringUtils;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

class TournamentRuleSupport {
    private final TournamentRuleRepository rules;
    private final TournamentDefaultRulesRepository defaults;

    TournamentRuleSupport(final TournamentRuleRepository rules, final TournamentDefaultRulesRepository defaults) {
        this.rules = rules; this.defaults = defaults;
    }
    TournamentDefaultRules defaultSlot() {
        return defaults.findById(1L).orElseThrow(() -> new IllegalStateException("Missing tournament default singleton"));
    }
    List<TournamentSnapshot.RuleRound> snapshot(final List<TournamentRule> configured) {
        return configured.stream().map(rule -> new TournamentSnapshot.RuleRound(rule.roundNumber, List.copyOf(rule.days))).toList();
    }
    List<TournamentRule> effectiveRules(final TournamentEvent event) {
        return effectiveRules(event, "INHERIT".equals(event.ruleSource) ? defaultSlot() : null);
    }
    List<TournamentRule> effectiveRules(final TournamentEvent event, final TournamentDefaultRules slot) {
        final List<TournamentRule> stored = rules.findByEventIdOrderByRoundNumber(event.id);
        if (!"INHERIT".equals(event.ruleSource)) { return stored; }
        return stored.stream().map(original -> {
            final TournamentRule effective = new TournamentRule(); effective.eventId = event.id; effective.roundNumber = original.roundNumber;
            effective.rulesVersion = slot.version;
            effective.days = slot.active ? slot.rounds.stream().filter(round -> round.roundNumber() == original.roundNumber)
                    .findFirst().map(TournamentSnapshot.RuleRound::days).orElse(List.of()).stream()
                    .filter(day -> day.dayNumber() <= event.daysPerRound).toList() : List.of();
            return effective;
        }).toList();
    }
    void materializeRules(final TournamentEvent event, final TournamentDefaultRules slot, final String source) {
        final List<TournamentRule> effective = effectiveRules(event, slot);
        for (final TournamentRule selected : effective) {
            final TournamentRule stored = rule(event.id, selected.roundNumber); stored.days = List.copyOf(selected.days); stored.rulesVersion = selected.rulesVersion;
        }
        event.ruleSource = source; event.frozenDefaultVersion = "FROZEN".equals(source) && slot.active ? slot.version : null;
    }
    void freezeRules(final TournamentEvent event, final Long expectedDefaultVersion) {
        if ("INHERIT".equals(event.ruleSource)) {
            final TournamentDefaultRules slot = defaults.findLocked();
            if (expectedDefaultVersion != null) { TournamentService.version(slot.version, expectedDefaultVersion); }
            materializeRules(event, slot, "FROZEN");
        } else {
            event.ruleSource = "FROZEN";
        }
    }
    TournamentRule rule(final long id, final int round) { return rules.findByEventIdAndRoundNumber(id, round).orElseThrow(() -> TournamentService.error(ApiErrorCode.RESOURCE_NOT_FOUND)); }
    boolean complete(final TournamentEvent event, final TournamentRule rule) {
        return complete(event, rule.days);
    }
    boolean complete(final TournamentEvent event, final List<TournamentSnapshot.RuleDay> configuredDays) {
        return complete(event.daysPerRound, configuredDays);
    }
    boolean complete(final int daysPerRound, final List<TournamentSnapshot.RuleDay> configuredDays) {
        if (configuredDays.size() != daysPerRound) { return false; }
        for (int number = 1; number <= daysPerRound; number++) {
            final int target = number;
            final Set<Integer> ranks = configuredDays.stream().filter(day -> day.dayNumber() == target).flatMap(day -> day.points().stream()).map(TournamentSnapshot.RankPoints::rank).collect(Collectors.toSet());
            if (!(ranks.contains(1) && ranks.contains(2) && ranks.contains(3) && ranks.contains(4))) { return false; }
        }
        return true;
    }
    static Map<Integer, Integer> rulePoints(final TournamentRule rule, final int number) {
        if (rule == null) { return Map.of(); }
        return rule.days.stream().filter(day -> day.dayNumber() == number).findFirst().map(day -> day.points().stream()
                .collect(Collectors.toMap(TournamentSnapshot.RankPoints::rank, TournamentSnapshot.RankPoints::points))).orElse(Map.of());
    }
    List<TournamentSnapshot.RuleDay> normalizeRules(final int daysPerRound, final List<TournamentDtos.RuleDay> input) {
        if (input == null || input.size() > daysPerRound) { throw TournamentService.invalid(); }
        final Set<Integer> seenDays = new HashSet<>(); final List<TournamentSnapshot.RuleDay> result = new ArrayList<>();
        for (final TournamentDtos.RuleDay day : input) {
            if (day == null || day.dayNumber() < 1 || day.dayNumber() > daysPerRound || !seenDays.add(day.dayNumber()) || day.points() == null || day.points().size() > 5) { throw TournamentService.invalid(); }
            final Set<Integer> ranks = new HashSet<>(); final List<TournamentSnapshot.RankPoints> points = new ArrayList<>();
            for (final TournamentDtos.RankPoints point : day.points()) {
                if (point == null || point.rank() < 1 || point.rank() > 5 || !ranks.add(point.rank()) || point.points() < 0 || point.points() > 1_000_000) { throw TournamentService.invalid(); }
                points.add(new TournamentSnapshot.RankPoints(point.rank(), point.points()));
            }
            points.sort(Comparator.comparingInt(TournamentSnapshot.RankPoints::rank)); result.add(new TournamentSnapshot.RuleDay(day.dayNumber(), List.copyOf(points)));
        }
        result.sort(Comparator.comparingInt(TournamentSnapshot.RuleDay::dayNumber)); return List.copyOf(result);
    }
    void validateEvent(final int year, final String region, final String season, final int rounds, final int number, final List<String> labels) {
        if (year < 2000 || year > 2100 || region == null || !Set.of("CN", "ASIA", "EU", "NA").contains(region) || season == null
                || !Set.of("SPRING", "SUMMER", "AUTUMN", "WINTER", "FIRE_CUP").contains(season) || rounds < 4 || rounds > 5 || number < 2 || number > 3
                || labels == null || labels.size() != number || labels.stream().anyMatch(label -> !StringUtils.hasText(label) || label.length() > 64)) { throw TournamentService.invalid(); }
    }
}
