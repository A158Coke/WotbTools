package com.wotb.core.stats;

import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AggregatorTest {

    @Test
    void aggregateFallsBackToAccountIdWhenLatestNicknameIsWhitespace() {
        final Battle olderBattle = battle(100L, "Recorder");
        final Battle latestBattle = battle(200L, "   ");

        final Map<Long, Agg> aggregated = Aggregator.aggregate(
                List.of(olderBattle, latestBattle), Tankopedia.load());

        assertEquals("1", aggregated.get(1L).nickname);
    }

    private static Battle battle(final long startTime, final String nickname) {
        final Battle battle = new Battle();
        battle.startTime = startTime;
        battle.winnerTeam = 1;
        battle.players = List.of(player(1L, nickname));
        return battle;
    }

    private static PlayerResult player(final long accountId, final String nickname) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = 1;
        player.tankId = 6481L;
        return player;
    }
}
