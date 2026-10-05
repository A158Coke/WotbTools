package com.wotb.web.tournament.mapper;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class TournamentMapper implements Mapper<TournamentEvent, TournamentDtos.Event> {
    @Override
    public TournamentDtos.Event toDto(final TournamentEvent event) {
        return new TournamentDtos.Event(event.id, event.version, event.year, region(event.region),
                season(event.season), event.roundCount, event.daysPerRound,
                List.copyOf(event.dayLabels), event.configLocked);
    }
    public TournamentDtos.RoundRule round(final TournamentRule rule, final boolean complete, final boolean locked) {
        return new TournamentDtos.RoundRule(rule.roundNumber, rule.rulesVersion, complete, locked,
                rule.days.stream().map(day -> new TournamentDtos.RuleDay(day.dayNumber(), day.points().stream()
                        .map(point -> new TournamentDtos.RankPoints(point.rank(), point.points())).toList())).toList());
    }
    public TournamentDtos.Group group(final TournamentSnapshot.Group group) {
        return new TournamentDtos.Group(group.groupNumber(), group.evidenceId(), group.imageHash(),
                group.teams().stream().map(team -> new TournamentDtos.Team(team.clanTag(), team.rank())).toList());
    }
    public TournamentDtos.Audit audit(final TournamentAudit audit) {
        return new TournamentDtos.Audit(audit.id, audit.action, audit.actor, audit.reason, audit.roundNumber,
                audit.dayNumber, audit.createdAt, audit.beforeState, audit.afterState);
    }
    private static String region(final String value) {
        return switch (value) { case "CN" -> "CN"; case "ASIA" -> "ASIA"; case "EU" -> "EU"; case "NA" -> "NA";
            default -> throw new IllegalStateException("Unknown stored tournament region"); };
    }
    private static String season(final String value) {
        return switch (value) { case "SPRING" -> "SPRING"; case "SUMMER" -> "SUMMER"; case "AUTUMN" -> "AUTUMN";
            case "WINTER" -> "WINTER"; case "FIRE_CUP" -> "FIRE_CUP";
            default -> throw new IllegalStateException("Unknown stored tournament season"); };
    }
}
