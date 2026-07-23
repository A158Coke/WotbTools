package com.wotb.core.processing;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 18.1: BattleCategory + Scope 测试。
 */
class BattleCategoryUtilsTest {

    @Test
    void arenaBonusType1IsRandom() {
        assertEquals(BattleCategory.RANDOM, BattleCategoryUtils.fromArenaBonusType(1));
    }

    @Test
    void arenaBonusType2IsTraining() {
        assertEquals(BattleCategory.TRAINING, BattleCategoryUtils.fromArenaBonusType(2));
    }

    @Test
    void arenaBonusType3to10IsTournament() {
        assertEquals(BattleCategory.TOURNAMENT, BattleCategoryUtils.fromArenaBonusType(3));
        assertEquals(BattleCategory.TOURNAMENT, BattleCategoryUtils.fromArenaBonusType(5));
        assertEquals(BattleCategory.TOURNAMENT, BattleCategoryUtils.fromArenaBonusType(10));
    }

    @Test
    void unknownArenaBonusTypeReturnsUnknown() {
        assertEquals(BattleCategory.UNKNOWN, BattleCategoryUtils.fromArenaBonusType(0));
        assertEquals(BattleCategory.UNKNOWN, BattleCategoryUtils.fromArenaBonusType(-1));
        assertEquals(BattleCategory.UNKNOWN, BattleCategoryUtils.fromArenaBonusType(99));
        assertEquals(BattleCategory.UNKNOWN, BattleCategoryUtils.fromArenaBonusType(null));
    }

    @Test
    void randomResolvesToPlayerFocused() {
        assertEquals(ReplayAnalysisScope.PLAYER_FOCUSED,
                BattleCategoryUtils.resolveScope(BattleCategory.RANDOM));
    }

    @Test
    void trainingResolvesToTeamPerspective() {
        assertEquals(ReplayAnalysisScope.TEAM_PERSPECTIVE,
                BattleCategoryUtils.resolveScope(BattleCategory.TRAINING));
    }

    @Test
    void tournamentResolvesToTeamPerspective() {
        assertEquals(ReplayAnalysisScope.TEAM_PERSPECTIVE,
                BattleCategoryUtils.resolveScope(BattleCategory.TOURNAMENT));
    }

    @Test
    void unknownThrowsException() {
        assertThrows(UnsupportedBattleCategoryException.class,
                () -> BattleCategoryUtils.resolveScope(BattleCategory.UNKNOWN));
    }
}
