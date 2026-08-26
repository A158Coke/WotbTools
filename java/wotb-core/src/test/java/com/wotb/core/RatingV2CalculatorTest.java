package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.KillVictim;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.RatingV2Calculator;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RatingV2CalculatorTest {

    @Test
    void keepsHistoricalKastTradeAndCompositeOrdering() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 2600, 400, 2, true, 0, 4481),
                player(2, 1, 100, 0, 0, false, 123, 4481),
                player(3, 2, 600, 0, 0, false, 120, 19217),
                player(4, 2, 200, 0, 0, false, 123, 19217)
        );

        final List<RatingV2Calculator.Row> rows = RatingV2Calculator.compute(List.of(battle), Tankopedia.load());
        final RatingV2Calculator.Row carry = row(rows, 1);
        final RatingV2Calculator.Row low = row(rows, 2);
        final RatingV2Calculator.Row traded = row(rows, 3);

        assertEquals(400.0, carry.assistAvg, 0.01);
        assertEquals(100.0, carry.kast, 0.1);
        assertEquals(100.0, traded.kast, 0.01);
        assertTrue(carry.impact.endsWith("%"));
        assertEquals(100.0, carry.multiDamageRate, 0.01);
        assertTrue(carry.rating > low.rating);
        assertEquals(carry.accountId, rows.getFirst().accountId);
    }

    @Test
    void usesObservedEntryHpThenTankopediaAndDividesByFourteen() {
        final Tankopedia tankopedia = Tankopedia.load();
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            final PlayerResult teamOne = player(index + 1L, 1, 0, 0, 0, true, 0, 4481);
            if (index == 0) {
                teamOne.entryHpSource = EntryHpSource.OBSERVED_EXACT;
                teamOne.entryHp = 2600;
            }
            players.add(teamOne);
            players.add(player(index + 8L, 2, 0, 0, 0, true, 0, 19217));
        }
        final Battle battle = new Battle();
        battle.players = players;

        final double expected = (2600.0 + 6.0 * tankopedia.info(4481L).maxHp()
                + 7.0 * tankopedia.info(19217L).maxHp()) / 14.0;
        final List<RatingV2Calculator.Row> rows = RatingV2Calculator.compute(List.of(battle), tankopedia);

        assertEquals(expected, row(rows, 1L).averageHp, 0.01);
        assertEquals(expected, row(rows, 8L).averageHp, 0.01);
    }

    @Test
    void fallsBackTo2400OnlyForTheMissingVehicle() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1, 1, 0, 0, 0, true, 0, -1));

        final RatingV2Calculator.Row result = RatingV2Calculator.compute(List.of(battle), Tankopedia.load()).getFirst();

        assertEquals(2400.0 / 14.0, result.averageHp, 0.01);
    }

    @Test
    void fallsBackToAccountIdForABlankNickname() {
        final PlayerResult player = player(1, 1, 0, 0, 0, true, 0, 4481);
        player.nickname = "   ";
        final Battle battle = new Battle();
        battle.players = List.of(player);

        final RatingV2Calculator.Row result = RatingV2Calculator.compute(List.of(battle), Tankopedia.load()).getFirst();

        assertEquals("1", result.nickname);
    }

    @Test
    void keepsTheHistoricalCompositeFormulaScale() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            players.add(player(index + 1L, index < 7 ? 1 : 2, 0, 0, 0, true, 0, -1));
        }
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = players;

        final List<RatingV2Calculator.Row> rows = RatingV2Calculator.compute(List.of(battle), Tankopedia.load());

        assertEquals(150, row(rows, 1).rating);
        assertEquals(0, row(rows, 8).rating);
    }

    @Test
    void calculatesPotentialDamageLocallyWithoutMutatingTheSharedBattle() {
        final PlayerResult player = player(1, 1, 100, 0, 0, true, 0, 4481);
        final KillVictim victim = new KillVictim(7, 100, 1);
        player.killVictims.add(victim);
        player.contribution = 11.0;
        player.kast = 22.0;
        player.impact = 33.0;
        final Battle battle = new Battle();
        battle.players = List.of(player);

        final RatingV2Calculator.Row result = RatingV2Calculator.compute(List.of(battle), Tankopedia.load()).getFirst();

        assertEquals(369.0, result.potentialDamageAvg, 0.01);
        assertEquals(269.0, result.potentialDamageSupplementAvg, 0.01);
        assertSame(victim, player.killVictims.getFirst());
        assertEquals(11.0, player.contribution);
        assertEquals(22.0, player.kast);
        assertEquals(33.0, player.impact);
    }

    @Test
    void preservesTheHistoricalNegativeDamageGuard() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1, 1, -1, 0, 0, true, 0, 4481));

        assertThrows(IllegalArgumentException.class,
                () -> RatingV2Calculator.compute(List.of(battle), Tankopedia.load()));
    }

    private static RatingV2Calculator.Row row(final List<RatingV2Calculator.Row> rows, final long accountId) {
        return rows.stream().filter(value -> value.accountId == accountId).findFirst().orElseThrow();
    }

    private static PlayerResult player(final long accountId, final int team, final int damage,
                                       final int assist, final int kills, final boolean survived,
                                       final double survivalTimeSec, final long tankId) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = "p" + accountId;
        player.team = team;
        player.tankId = tankId;
        player.damageDealt = damage;
        player.damageAssisted = assist;
        player.kills = kills;
        player.survived = survived;
        player.survivalTimeSec = survivalTimeSec;
        return player;
    }
}
