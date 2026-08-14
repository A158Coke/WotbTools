package com.wotb.core.processing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult.PointsEndReason;
import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.FriendlyEnemyResult.WinnerSource;
import com.wotb.core.processing.PlayerSideResolver.Side;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

/**
 * Tests for PlayerSideResolver and FriendlyEnemyResult covering sections 8.1–8.5.
 * Does NOT modify PlayerResult.team (the raw number is preserved).
 */
class PlayerSideResolverTest {

    // ========== isValidRawTeam ==========

    @Test
    void isValidRawTeam_1() { assertTrue(PlayerSideResolver.isValidRawTeam(1)); }

    @Test
    void isValidRawTeam_2() { assertTrue(PlayerSideResolver.isValidRawTeam(2)); }

    @Test
    void isValidRawTeam_negative1() { assertFalse(PlayerSideResolver.isValidRawTeam(-1)); }

    @Test
    void isValidRawTeam_zero() { assertFalse(PlayerSideResolver.isValidRawTeam(0)); }

    @Test
    void isValidRawTeam_3() { assertFalse(PlayerSideResolver.isValidRawTeam(3)); }

    @Test
    void isValidRawTeam_maxInt() { assertFalse(PlayerSideResolver.isValidRawTeam(Integer.MAX_VALUE)); }

    // ========== 8.1 Recorder in raw team 1 ==========

    @Test
    void recorderTeam1_selfIsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(1, 1));
    }

    @Test
    void recorderTeam1_team2IsEnemy() {
        assertEquals(Side.ENEMY, PlayerSideResolver.resolve(1, 2));
    }

    // ========== 8.2 Recorder in raw team 2 ==========

    @Test
    void recorderTeam2_selfIsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(2, 2));
    }

    @Test
    void recorderTeam2_team1IsEnemy() {
        assertEquals(Side.ENEMY, PlayerSideResolver.resolve(2, 1));
    }

    @Test
    void recorderTeam2_notHardcodedTeam1AsFriendly() {
        final Battle battle = createBattle(2, List.of(
                player(1, "ActuallyEnemy"),
                player(2, "ActuallyFriendly")
        ));
        final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        assertEquals(Side.ENEMY, sides.get(battle.players.get(0)));
        assertEquals(Side.FRIENDLY, sides.get(battle.players.get(1)));
    }

    // ========== 8.3 Winner conversion ==========

    @Test
    void winnerEqualsRecorderTeam_friendlyWin() {
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(1, 1));
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(2, 2));
    }

    @Test
    void winnerDiffersFromRecorderTeam_enemyWin() {
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(2, 1));
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(1, 2));
    }

    @Test
    void winnerNull_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(null, 1));
    }

    @Test
    void winnerZero_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(0, 1));
    }

    @Test
    void winnerTeam3_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(3, 1));
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(Integer.MAX_VALUE, 1));
    }

    // ========== 8.4 Unknown cases ==========

    @Test
    void recorderResultMissing_unknown() {
        final Battle battle = new Battle();
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void recorderTeamZero_unknown() {
        final Battle battle = createBattle(0, List.of(player(1, "P1")));
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void recorderTeam3_unknown() {
        final Battle battle = createBattle(3, List.of(player(3, "P1")));
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void playerTeamZero_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(1, 0));
    }

    @Test
    void playerTeam3_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(1, 3));
    }

    @Test
    void nullBattle_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(null, new PlayerResult()));
    }

    @Test
    void nullPlayer_unknown() {
        final Battle battle = createBattle(1, List.of(player(1, "P1")));
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(battle, null));
    }

    @Test
    void winnerTeamInvalid_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(-1, 1));
    }

    // ========== 8.5 Multi-Player ==========

    @Test
    void multiPlayer_eachBattleIndependent() {
        final Battle battleA = createBattle(1, List.of(
                player(1, "A_Friendly"),
                player(2, "A_Enemy")
        ));
        final Battle battleB = createBattle(2, List.of(
                player(2, "B_Friendly"),
                player(1, "B_Enemy")
        ));

        final Map<PlayerResult, Side> sidesA = PlayerSideResolver.resolveAll(battleA);
        final Map<PlayerResult, Side> sidesB = PlayerSideResolver.resolveAll(battleB);

        assertEquals(Side.FRIENDLY, sidesA.get(battleA.players.get(0)), "Battle A team1 is friendly");
        assertEquals(Side.ENEMY, sidesA.get(battleA.players.get(1)), "Battle A team2 is enemy");
        assertEquals(Side.FRIENDLY, sidesB.get(battleB.players.get(0)), "Battle B team2 is friendly");
        assertEquals(Side.ENEMY, sidesB.get(battleB.players.get(1)), "Battle B team1 is enemy");

        // Verify raw team numbers are preserved
        assertEquals(1, battleA.players.get(0).team);
        assertEquals(2, battleA.players.get(1).team);
        assertEquals(2, battleB.players.get(0).team);
        assertEquals(1, battleB.players.get(1).team);
    }

    // ========== 5. Recorder team 2 correctness ==========

    @Test
    void recorderTeam2_friendlyWin() {
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(2, 2));
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(1, 2));
    }

    @Test
    void recorderTeam1_friendlyWin() {
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(1, 1));
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(2, 1));
    }

    // ========== 9. Supremacy team-battle winner (FriendlyEnemyResult.resolveTeamBattle) ==========

    @Test
    void supremacy_winnerFromBattleResults_isAuthoritative() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, "A1", true, 100),
                player(1, "A2", true, 100),
                player(2, "B1", false, 50));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        assertEquals(Winner.FRIENDLY_WIN, w.winner());
        assertEquals(WinnerSource.BATTLE_RESULTS, w.source());
        assertFalse(w.pointsDecided(), "enemy team fully destroyed -> not a points victory");
        assertEquals(PointsEndReason.NOT_APPLICABLE, w.pointsEndReason());
    }

    @Test
    void supremacy_winnerPresentButNoFullWipe_isPointsDecided() {
        final Battle battle = new Battle();
        battle.winnerTeam = 2;
        battle.rosterComplete = true;
        battle.arenaBonusType = 3; // 官方联赛：标准时限证据
        battle.durationS = 420.0;  // 打到 7 分钟且双方部分分均 <1000 → 时间耗尽
        battle.players = List.of(
                player(1, "A1", true, 100),
                player(2, "B1", true, 500));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        assertEquals(Winner.ENEMY_WIN, w.winner());
        assertEquals(WinnerSource.BATTLE_RESULTS, w.source());
        assertTrue(w.pointsDecided(), "neither team fully destroyed -> supremacy points victory");
        assertEquals(PointsEndReason.TIME_EXPIRED, w.pointsEndReason(),
                "both sides below 1000 points and time exhausted -> time-expired points decision");
    }

    @Test
    void supremacy_winnerMissing_enemyWiped_friendlyWinsBySettlement() {
        final Battle battle = new Battle();
        battle.winnerTeam = null;
        battle.rosterComplete = true;
        battle.players = List.of(
                player(1, "A1", true, 0),
                player(1, "A2", true, 0),
                player(2, "B1", false, 999),
                player(2, "B2", false, 999));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        assertEquals(Winner.FRIENDLY_WIN, w.winner());
        assertEquals(WinnerSource.SURVIVOR_SETTLEMENT, w.source());
        assertFalse(w.pointsDecided());
    }

    @Test
    void supremacy_winnerMissing_friendlyWiped_enemyWinsBySettlement() {
        final Battle battle = new Battle();
        battle.winnerTeam = null;
        battle.rosterComplete = true;
        battle.players = List.of(
                player(1, "A1", false, 200),
                player(2, "B1", true, 100));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        assertEquals(Winner.ENEMY_WIN, w.winner());
        assertEquals(WinnerSource.SURVIVOR_SETTLEMENT, w.source());
    }

    @Test
    void supremacy_winnerMissing_noFullWipe_failsClosed() {
        final Battle battle = new Battle();
        battle.winnerTeam = null;
        battle.rosterComplete = true;
        battle.players = List.of(
                player(1, "A1", true, 300),
                player(1, "A2", true, 300),
                player(2, "B1", true, 700),
                player(2, "B2", true, 0));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        // 无权威胜方：占点分不含被动增长与击杀夺分，禁止比较推断胜方 → fail closed
        assertEquals(Winner.DRAW_OR_UNKNOWN, w.winner());
        assertEquals(WinnerSource.UNKNOWN, w.source());
        assertTrue(w.pointsDecided());
        assertEquals(PointsEndReason.UNKNOWN, w.pointsEndReason(),
                "无标准时限证据（类别未知）→ 结束方式未知");
    }

    @Test
    void supremacy_standardRulesEarlyEnd_isReached1000() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.rosterComplete = true;
        battle.arenaBonusType = 3; // 已知类别：业务规则固定 7 分钟/1000 分
        battle.durationS = 300.0;  // 双方均有存活且时长 <7 分钟 → 达到 1000 分提前获胜
        battle.players = List.of(
                player(1, "A1", true, 1043),
                player(2, "B1", true, 280));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        assertEquals(Winner.FRIENDLY_WIN, w.winner());
        assertTrue(w.pointsDecided());
        assertEquals(PointsEndReason.REACHED_1000, w.pointsEndReason(),
                "standard rules + both teams alive + duration < 420s -> reached 1000 (business rule)");
    }

    @Test
    void supremacy_winnerMissing_equalPoints_remainsUnknown() {
        final Battle battle = new Battle();
        battle.winnerTeam = null;
        battle.rosterComplete = true;
        battle.players = List.of(
                player(1, "A1", true, 100),
                player(2, "B1", true, 100));
        final TeamBattleWinner w = FriendlyEnemyResult.resolveTeamBattle(battle, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, w.winner());
        assertEquals(WinnerSource.UNKNOWN, w.source());
        assertTrue(w.pointsDecided(), "both alive -> supremacy points mode, but score tie");
    }

    @Test
    void supremacy_invalidRecorderOrMissingRoster_unknown() {
        final Battle battle = new Battle();
        battle.winnerTeam = null;
        battle.players = List.of(player(1, "A1", true, 100));
        assertEquals(Winner.DRAW_OR_UNKNOWN,
                FriendlyEnemyResult.resolveTeamBattle(battle, 3).winner());
        assertEquals(Winner.DRAW_OR_UNKNOWN,
                FriendlyEnemyResult.resolveTeamBattle(null, 1).winner());
        final Battle noPlayers = new Battle();
        noPlayers.winnerTeam = null;
        assertEquals(Winner.DRAW_OR_UNKNOWN,
                FriendlyEnemyResult.resolveTeamBattle(noPlayers, 1).winner());
    }

    // ========== Helpers ==========

    private static Battle createBattle(final int recorderTeam, final List<PlayerResult> players) {
        final Battle battle = new Battle();
        battle.recorder = "Recorder";
        battle.players = players;
        final PlayerResult rec = players.stream()
                .filter(p -> p.team == recorderTeam)
                .findFirst().orElse(null);
        if (rec != null) {
            rec.nickname = "Recorder";
        }
        return battle;
    }

    private static PlayerResult player(final int team, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.team = team;
        p.nickname = nickname;
        return p;
    }

    private static PlayerResult player(final int team, final String nickname,
                                       final boolean survived, final int points) {
        final PlayerResult p = player(team, nickname);
        p.survived = survived;
        p.victoryPointsEarned = points;
        return p;
    }
}
