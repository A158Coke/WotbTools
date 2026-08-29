package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.RatingV2Calculator;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
    void unknownDeathResidualNeverElevatesTrade() {
        // P0-2：A 阵亡但 deathTimeSource=UNKNOWN（residual survivalTimeSec=100）→ canonical deathSec=0。
        // 即使存在 KNOWN 敌方死亡@102（旧版会落入 ±5s 窗口），A 也不得被当作 traded 偷渡成 KNOWN。
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        final PlayerResult a = player(2, 1, 100, 0, 0, false, 100.0, 4481);
        a.deathTimeSource = DeathTimeSource.UNKNOWN; // residual 100 非 KNOWN
        a.deathTimeMillis = 0L;
        battle.players = List.of(
                player(1, 1, 100, 0, 0, true, 0, 4481),
                a,
                player(3, 2, 120, 0, 0, false, 102.0, 19217),
                player(4, 2, 200, 0, 0, false, 125.0, 19217));
        final List<RatingV2Calculator.Row> rows = RatingV2Calculator.compute(List.of(battle), Tankopedia.load());
        // A 不得因 UNKNOWN residual 被当作 traded（traded→tradeScore=1→KAST=100）；应为低分（未 traded）
        assertTrue(row(rows, 2).kast < 100.0,
                "UNKNOWN residual 不得当作 KNOWN 死亡参与互换判定: kast=" + row(rows, 2).kast);
    }

    @Test
    void usesStaticTankopediaBaselineAndDividesByFourteen() {
        // The V2 HP denominator is a static tankopedia baseline (never replay actual-HP truth), divided
        // over the standard 14 battle slots (see RatingV2Calculator JavaDoc).
        final Tankopedia tankopedia = Tankopedia.load();
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            players.add(player(index + 1L, 1, 0, 0, 0, true, 0, 4481));
            players.add(player(index + 8L, 2, 0, 0, 0, true, 0, 19217));
        }
        final Battle battle = new Battle();
        battle.players = players;

        final double expected = (7.0 * tankopedia.info(4481L).maxHp()
                + 7.0 * tankopedia.info(19217L).maxHp()) / 14.0;
        final List<RatingV2Calculator.Row> rows = RatingV2Calculator.compute(List.of(battle), tankopedia);

        assertEquals(expected, row(rows, 1L).averageHp, 0.01);
        assertEquals(expected, row(rows, 8L).averageHp, 0.01);
    }

    @Test
    void observedEntryHpDoesNotOverrideTheStaticBaselineDenominator() {
        // A player whose entryHpSource == OBSERVED_EXACT (entryHp = 2600, conflicting with the tankopedia
        // maxHp for tank 4481) must NOT switch the denominator to replay actual HP. Both players drive the
        // same tank, so both share the identical tankopedia maxHp baseline — observed entry HP is ignored.
        final Tankopedia tankopedia = Tankopedia.load();
        final PlayerResult observed = player(1L, 1, 0, 0, 0, true, 0, 4481);
        observed.entryHpSource = EntryHpSource.OBSERVED_EXACT;
        observed.entryHp = 2600;
        final PlayerResult baseline = player(2L, 1, 0, 0, 0, true, 0, 4481);
        final Battle battle = new Battle();
        battle.players = List.of(observed, baseline);

        final double expected = 2.0 * tankopedia.info(4481L).maxHp() / 14.0;
        final List<RatingV2Calculator.Row> rows = RatingV2Calculator.compute(List.of(battle), tankopedia);

        assertEquals(expected, row(rows, 1L).averageHp, 0.01);
        assertEquals(expected, row(rows, 2L).averageHp, 0.01);
    }

    @Test
    void fallsBackToStaticBaselineOnlyForTheMissingVehicle() {
        // tankopedia data missing → STATIC_BASELINE fallback for the historical gray-page V2 formula.
        // This is a static baseline, not replay actual-HP truth (see RatingV2Calculator JavaDoc).
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
        // §P0-6: no killVictims supplement anymore — potential damage is observed damage only.
        final PlayerResult player = player(1, 1, 100, 0, 0, true, 0, 4481);
        player.contribution = 11.0;
        player.kast = 22.0;
        player.impact = 33.0;
        final Battle battle = new Battle();
        battle.players = List.of(player);

        final RatingV2Calculator.Row result = RatingV2Calculator.compute(List.of(battle), Tankopedia.load()).getFirst();

        assertEquals(100.0, result.potentialDamageAvg, 0.01);
        assertEquals(0.0, result.potentialDamageSupplementAvg, 0.01);
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
        // canonical death provenance（P0-2）：已知死亡（survivalTimeSec>0）携带 SETTLEMENT_SECOND；
        // 否则 UNKNOWN（residual 不得成为 authoritative death fact）。
        if (!survived) {
            player.deathTimeSource = survivalTimeSec > 0
                    ? DeathTimeSource.SETTLEMENT_SECOND : DeathTimeSource.UNKNOWN;
            player.deathTimeMillis = survivalTimeSec > 0
                    ? Math.round(survivalTimeSec * 1000.0) : 0L;
        }
        return player;
    }
}
