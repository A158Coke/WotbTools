package com.wotb.web.tournament.entity;
import java.util.List;
public final class TournamentSnapshot {
    private TournamentSnapshot() { }
    public record Team(String clanTag, int rank) { }
    public record Group(int groupNumber, String evidenceId, String imageHash, List<Team> teams) { }
    public record RankPoints(int rank, int points) { }
    public record RuleRound(int roundNumber, List<RuleDay> days) { }
    public record RuleDay(int dayNumber, List<RankPoints> points) { }
}
