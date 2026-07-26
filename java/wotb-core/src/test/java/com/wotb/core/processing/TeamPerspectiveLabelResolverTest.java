package com.wotb.core.processing;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class TeamPerspectiveLabelResolverTest {

    private static PlayerResult player(final int team, final String clan, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.team = team;
        p.clan = clan;
        p.nickname = nickname;
        return p;
    }

    @Test
    void allSameClan() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
        player(1, "CHRD", "C"), player(1, "CHRD", "D"),
        player(1, "CHRD", "E"), player(1, "CHRD", "F"),
        player(1, "CHRD", "G"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(roster));
    }

    @Test
    void dominantClan5of7() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "CHRD", "C"), player(1, "CHRD", "D"),
                player(1, "CHRD", "E"),
                player(1, "KSR", "F"), player(1, "", "G"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(roster));
    }

    @Test
    void uniqueHighestEvenIf3of7() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "CHRD", "C"),
                player(1, "KSR", "D"), player(1, "KSR", "E"),
                player(1, "FUN", "F"), player(1, "", "G"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(roster));
    }

    @Test
    void tiedHighestCountUsesFallback() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "KSR", "C"), player(1, "KSR", "D"),
                player(1, "", "E"));
        final String label = TeamPerspectiveLabelResolver.resolve(roster);
        assertTrue(label.startsWith("队伍-"), "Tie should use fallback, got: " + label);
        assertFalse(label.contains("1") && label.contains("2"),
                "Fallback must not contain raw team numbers");
    }

    @Test
    void allEmptyClanUsesFallback() {
        final List<PlayerResult> roster = List.of(
                player(1, "", "A"), player(1, "", "B"), player(1, "", "C"));
        final String label = TeamPerspectiveLabelResolver.resolve(roster);
        assertTrue(label.startsWith("队伍-"), "Empty clan should use fallback, got: " + label);
    }

    @Test
    void clanWithSpacesIsNormalized() {
        final List<PlayerResult> roster = List.of(
                player(1, " CHRD ", "A"), player(1, "CHRD", "B"),
                player(1, "  chrd  ", "C"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(roster));
    }

    @Test
    void caseInsensitiveCounting() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "chrd", "B"),
                player(1, "Chrd", "C"), player(1, "KSR", "D"));
        final String label = TeamPerspectiveLabelResolver.resolve(roster);
        // Should resolve to one of the original casings of the dominant clan
        assertTrue(label.equals("CHRD") || label.equals("chrd") || label.equals("Chrd"),
                "Should resolve to one of the original casings, got: " + label);
    }

    @Test
    void recorderInRawTeam2() {
        final List<PlayerResult> roster = List.of(
                player(2, "CHRD", "Recorder"), player(2, "CHRD", "B"),
                player(2, "KSR", "C"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(roster));
    }

    @Test
    void opposingPerspectivesResolveIndependently() {
        final List<PlayerResult> team1 = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "CHRD", "C"));
        final List<PlayerResult> team2 = List.of(
                player(2, "KSR", "D"), player(2, "KSR", "E"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(team1));
        assertEquals("KSR", TeamPerspectiveLabelResolver.resolve(team2));
    }

    @Test
    void rosterOrderDoesNotAffectResult() {
        final List<PlayerResult> roster = List.of(
                player(1, "KSR", "Z"), player(1, "CHRD", "A"),
                player(1, "CHRD", "B"), player(1, "CHRD", "C"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(roster));
        // Shuffle
        final List<PlayerResult> shuffled = new ArrayList<>(roster);
        java.util.Collections.shuffle(shuffled, new java.util.Random(42));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolve(shuffled));
    }

    @Test
    void fallbackDoesNotContainRawTeam() {
        final List<PlayerResult> roster = List.of(
                player(1, "", "A"), player(1, "", "B"));
        final String label = TeamPerspectiveLabelResolver.resolve(roster);
        assertFalse(label.contains("Team 1"), "Fallback must not contain Team 1");
        assertFalse(label.contains("Team 2"), "Fallback must not contain Team 2");
        assertFalse(label.contains("队伍1"), "Fallback must not contain 队伍1");
        assertFalse(label.contains("队伍2"), "Fallback must not contain 队伍2");
        assertFalse(label.contains("perspectiveTeam"), "Fallback must not contain perspectiveTeam");
    }

    @Test
    void nullOrEmptyRosterReturnsDefault() {
        assertEquals("未知队伍", TeamPerspectiveLabelResolver.resolve(null));
        assertEquals("未知队伍", TeamPerspectiveLabelResolver.resolve(List.of()));
    }
}
