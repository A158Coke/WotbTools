package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiPromptLibraryTest {

    @Test
    void everyPromptKeyLoadsNonBlank() {
        assertLoaded("player/fallback", PlayerPromptRules.SYSTEM_PROMPT);
        assertLoaded("player/single", PlayerPromptRules.SINGLE_PLAYER_PROMPT);
        assertLoaded("player/tactical", TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT);
        assertLoaded("team/single", TeamPromptLocalizer.SINGLE_TEAM_PROMPT);
        assertLoaded("team/autopsy", TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT_SETTLEMENT_ONLY);
        assertLoaded("prebattle/system", PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT);
        assertLoaded("prebattle/user-header", PreBattlePromptBuilder.PRE_BATTLE_USER_HEADER);
        assertLoaded("prebattle/confidence-legend", PreBattlePromptBuilder.CONFIDENCE_LEGEND);
    }

    private static void assertLoaded(final String key, final String value) {
        assertNotNull(value, key + " must load");
        assertFalse(value.isBlank(), key + " must not be blank");
    }

    @Test
    void tacticalPromptBuildsOnFallback() {
        assertTrue(TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT
                        .startsWith(PlayerPromptRules.SYSTEM_PROMPT),
                "tactical prompt must start with the fallback system prompt");
    }

    @Test
    void promptsMustNotContainJavaTextBlockDelimiters() {
        assertFalse(TacticalReviewPromptBuilder.TACTICAL_SYSTEM_PROMPT.contains("\"\"\""),
                "prompt md must not contain Java text block delimiters");
    }
}
