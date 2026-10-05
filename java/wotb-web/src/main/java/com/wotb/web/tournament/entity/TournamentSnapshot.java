package com.wotb.web.tournament.entity;
import java.util.List;
/** Immutable persisted group identity and ranks; all scores are derived from rules. */
public final class TournamentSnapshot {
    private TournamentSnapshot() { }
    public record Team(String clanTag, int rank) { }
    public record Group(int groupNumber, String evidenceId, String imageHash, List<Team> teams) { }
    public record RankPoints(int rank, int points) { }
    public record RuleDay(int dayNumber, List<RankPoints> points) { }
}
