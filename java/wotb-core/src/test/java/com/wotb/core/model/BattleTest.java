package com.wotb.core.model;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class BattleTest {

    @Test
    void recorderResultSkipsWhitespaceRecorderName() {
        final Battle battle = new Battle();
        battle.recorder = "   ";
        battle.players = List.of(player(1L, "Recorder"));

        assertNull(battle.recorderResult());
    }

    @Test
    void recorderResultMatchesRecorderByNickname() {
        final Battle battle = new Battle();
        final PlayerResult recorder = player(1L, "Recorder");
        battle.recorder = "Recorder";
        battle.players = List.of(recorder, player(2L, "Other"));

        assertSame(recorder, battle.recorderResult());
    }

    private static PlayerResult player(final long accountId, final String nickname) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        return player;
    }
}
