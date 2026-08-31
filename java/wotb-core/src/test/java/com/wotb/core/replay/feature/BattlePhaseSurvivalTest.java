package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BattlePhaseSurvivalTest {
    @Test
    void phaseSurvivalUsesSettlementSeconds() {
        final PlayerResult friendly = player(1, false, 10);
        final PlayerResult enemy = player(2, false, 20);
        final Battle battle = new Battle();
        battle.players = List.of(friendly, enemy);
        final var timeline = BattlePhaseSummary.SurvivalTimeline.fromBattleResults(battle, 1);
        final var phases = BattlePhaseSummary.buildRelativePhasesWithSurvival(5, 30, timeline);
        assertEquals(1, phases.getFirst().friendlyAlive());
        assertEquals(1, phases.getFirst().enemyAlive());
    }

    private static PlayerResult player(final long account, final boolean survived, final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = account;
        p.team = account == 1 ? 1 : 2;
        p.survived = survived;
        p.settlementLifeTimeSec = survived ? 0 : deathSec;
        return p;
    }
}
