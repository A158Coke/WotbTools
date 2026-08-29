package com.wotb.core.replay.processing;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * internal identity 与 user-facing display label 分离。
 * <p>{@code resolveDisplayLabel} 只返回唯一 dominant 且严格多数（&gt; 一半）的 clan tag
 * （最常见 casing），否则空串；绝不返回 {@code 队伍-XXXX}。{@code resolveStableKey} 是
 * internal-only 身份键（可含 {@code 队伍-}），不得进入 user-facing 路径。</p>
 */
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
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster));
    }

    @Test
    void dominantClan5of7() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "CHRD", "C"), player(1, "CHRD", "D"),
                player(1, "CHRD", "E"),
                player(1, "KSR", "F"), player(1, "", "G"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster));
    }

    @Test
    void minorityDominant3of7IsNotAUserVisibleLabel() {
        // 3/7 是唯一最高但不是严格多数：不得把整队命名为该 clan（保守多数派规则）
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "CHRD", "C"),
                player(1, "KSR", "D"), player(1, "KSR", "E"),
                player(1, "FUN", "F"), player(1, "", "G"));
        assertEquals("", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster),
                "3/7 非多数 → 用户可见标签必须为空（fallback 我方/对方）");
        assertEquals("chrd", TeamPerspectiveLabelResolver.resolveDominantClanTag(roster),
                "内部 dominant tag 仍可用于 partition 逻辑（不要求多数）");
    }

    @Test
    void twoOfSevenSameClanIsNotAReliableLabel() {
        // 2 个玩家同 clan、其他 5 个全不同：禁止盲目命名为该 clan
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "KSR", "C"), player(1, "FUN", "D"),
                player(1, "ABC", "E"), player(1, "XYZ", "F"), player(1, "", "G"));
        assertEquals("", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster));
    }

    @Test
    void tiedHighestCountHasNoDisplayLabel() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "KSR", "C"), player(1, "KSR", "D"),
                player(1, "", "E"));
        assertEquals("", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster),
                "Tie → 用户可见标签为空（fallback 我方/对方），不得用 队伍-XXXX");
        assertTrue(TeamPerspectiveLabelResolver.resolveStableKey(roster).startsWith("队伍-"),
                "内部 stable key 可保留 队伍- hash（internal only）");
    }

    @Test
    void allEmptyClanHasNoDisplayLabel() {
        final List<PlayerResult> roster = List.of(
                player(1, "", "A"), player(1, "", "B"), player(1, "", "C"));
        assertEquals("", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster),
                "无 clan → 用户可见标签为空");
        assertTrue(TeamPerspectiveLabelResolver.resolveStableKey(roster).startsWith("队伍-"),
                "internal stable key 仍可用");
    }

    @Test
    void clanWithSpacesIsNormalized() {
        final List<PlayerResult> roster = List.of(
                player(1, " CHRD ", "A"), player(1, "CHRD", "B"),
                player(1, "  chrd  ", "C"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster));
    }

    @Test
    void caseInsensitiveCounting() {
        final List<PlayerResult> roster = List.of(
                player(1, "CHRD", "A"), player(1, "chrd", "B"),
                player(1, "Chrd", "C"), player(1, "KSR", "D"));
        final String label = TeamPerspectiveLabelResolver.resolveDisplayLabel(roster);
        // 3/4 严格多数：返回最常见 casing 之一
        assertTrue(label.equals("CHRD") || label.equals("chrd") || label.equals("Chrd"),
                "Should resolve to one of the original casings, got: " + label);
    }

    @Test
    void recorderInRawTeam2() {
        final List<PlayerResult> roster = List.of(
                player(2, "CHRD", "Recorder"), player(2, "CHRD", "B"),
                player(2, "KSR", "C"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster));
    }

    @Test
    void opposingPerspectivesResolveIndependently() {
        final List<PlayerResult> team1 = List.of(
                player(1, "CHRD", "A"), player(1, "CHRD", "B"),
                player(1, "CHRD", "C"));
        final List<PlayerResult> team2 = List.of(
                player(2, "KSR", "D"), player(2, "KSR", "E"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(team1));
        assertEquals("KSR", TeamPerspectiveLabelResolver.resolveDisplayLabel(team2));
    }

    @Test
    void rosterOrderDoesNotAffectResult() {
        final List<PlayerResult> roster = List.of(
                player(1, "KSR", "Z"), player(1, "CHRD", "A"),
                player(1, "CHRD", "B"), player(1, "CHRD", "C"));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(roster));
        // Shuffle
        final List<PlayerResult> shuffled = new ArrayList<>(roster);
        java.util.Collections.shuffle(shuffled, new java.util.Random(42));
        assertEquals("CHRD", TeamPerspectiveLabelResolver.resolveDisplayLabel(shuffled));
    }

    @Test
    void stableKeyDoesNotContainRawTeamWording() {
        final List<PlayerResult> roster = List.of(
                player(1, "", "A"), player(1, "", "B"));
        final String label = TeamPerspectiveLabelResolver.resolveStableKey(roster);
        assertFalse(label.contains("Team 1"), "Stable key must not contain Team 1");
        assertFalse(label.contains("Team 2"), "Stable key must not contain Team 2");
        assertFalse(label.contains("队伍1"), "Stable key must not contain 队伍1");
        assertFalse(label.contains("队伍2"), "Stable key must not contain 队伍2");
        assertFalse(label.contains("perspectiveTeam"), "Stable key must not contain perspectiveTeam");
    }

    @Test
    void nullOrEmptyRosterHasEmptyDisplayLabel() {
        assertEquals("", TeamPerspectiveLabelResolver.resolveDisplayLabel(null));
        assertEquals("", TeamPerspectiveLabelResolver.resolveDisplayLabel(List.of()));
        assertEquals("队伍-0", TeamPerspectiveLabelResolver.resolveStableKey(null));
        assertEquals("队伍-0", TeamPerspectiveLabelResolver.resolveStableKey(List.of()));
    }
}
