package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.RatingAnalyzer;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RatingAnalyzerTest {

    @Test
    void kastUsesBestSingleBattleContribution() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 0, 0, 0, false, 100, 1000),
                player(2, 1, 0, 0, 0, true, 0, 0),
                player(3, 2, 0, 0, 0, false, 104, 1000),
                player(4, 2, 0, 0, 0, false, 103, 1000)
        );

        final List<RatingAnalyzer.Row> rows = RatingAnalyzer.compute(List.of(battle), Tankopedia.load());
        final RatingAnalyzer.Row traded = row(rows, 1);

        assertEquals(100.0, traded.kast, 0.01);
    }

    @Test
    void ratingUsesPotentialAssistInfluenceMultiDamageAndKills() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 2600, 400, 2, true, 0, 0),
                player(2, 1, 100, 0, 0, true, 0, 0),
                player(3, 2, 600, 0, 0, false, 120, 1000),
                player(4, 2, 200, 0, 0, true, 0, 0)
        );

        final List<RatingAnalyzer.Row> rows = RatingAnalyzer.compute(List.of(battle), Tankopedia.load());
        final RatingAnalyzer.Row carry = row(rows, 1);
        final RatingAnalyzer.Row low = row(rows, 2);

        assertEquals(2400.0, carry.averageHp, 0.01);
        assertEquals(400.0, carry.assistAvg, 0.01);
        assertEquals(100.0, carry.kast, 0.1);
        assertTrue(carry.impact.endsWith("%"));
        assertEquals(100.0, carry.multiDamageRate, 0.01);
        assertTrue(carry.impactValue > low.impactValue);
        assertTrue(carry.rating > low.rating);
    }

    @Test
    void computeFallsBackToAccountIdWhenNicknameWhitespace() {
        final PlayerResult blankNicknamePlayer = player(1, 1, 2600, 400, 2, true, 0, 0);
        blankNicknamePlayer.nickname = "   ";
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                blankNicknamePlayer,
                player(2, 1, 100, 0, 0, true, 0, 0),
                player(3, 2, 600, 0, 0, false, 120, 1000),
                player(4, 2, 200, 0, 0, true, 0, 0)
        );

        final List<RatingAnalyzer.Row> rows = RatingAnalyzer.compute(List.of(battle), Tankopedia.load());

        assertEquals("1", row(rows, 1).nickname);
    }

    private static RatingAnalyzer.Row row(final List<RatingAnalyzer.Row> rows, final long accountId) {
        return rows.stream().filter(r -> r.accountId == accountId).findFirst().orElseThrow();
    }

    private static PlayerResult player(final long accountId, final int team, final int damage,
                                       final int assist, final int kills, final boolean survived,
                                       final double survivalTimeSec, final int damageReceived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = "p" + accountId;
        player.team = team;
        player.tankId = -1;
        player.damageDealt = damage;
        player.damageAssisted = assist;
        player.kills = kills;
        player.survived = survived;
        player.survivalTimeSec = survivalTimeSec;
        player.damageReceived = damageReceived;
        return player;
    }
}
