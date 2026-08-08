package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class PreBattlePromptBuilderTest {

    private static Battle battleWithFullResults() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(resultPlayer(1001, 1, 4481, "Kranvagn"));
        players.add(resultPlayer(1002, 1, 10785, "T110E5"));
        players.add(resultPlayer(2001, 2, 14609, "Leopard 1"));
        players.add(resultPlayer(2002, 2, 12305, "E 50 M"));
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.players = players;
        return b;
    }

    private static PlayerResult resultPlayer(final long accountId, final int team,
                                             final long tankId, final String tankName) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.survived = true;
        // 敏感战绩字段：任何泄漏都会让测试失败
        p.damageDealt = 77777;
        p.damageReceived = 88888;
        p.kills = 66;
        p.xp = 12345;
        p.deathTimeMillis = 99999L;
        return p;
    }

    @Test
    void userContentLeaksNoBattleResult() {
        final String content = PreBattlePromptBuilder.buildUserContent(
                battleWithFullResults(), TankTacticalProfileRegistry.load());
        assertFalse(content.contains("77777"), "damageDealt must not leak");
        assertFalse(content.contains("88888"), "damageReceived must not leak");
        assertFalse(content.contains("66"), "kills must not leak");
        assertFalse(content.contains("12345"), "xp must not leak");
        assertFalse(content.contains("99999"), "deathTime must not leak");
    }

    @Test
    void userContentContainsRosterAndProfiles() {
        final String content = PreBattlePromptBuilder.buildUserContent(
                battleWithFullResults(), TankTacticalProfileRegistry.load());
        assertTrue(content.contains("TEAM_A（队伍1）阵容"));
        assertTrue(content.contains("TEAM_B（队伍2）阵容"));
        assertTrue(content.contains("Kranvagn"));
        assertTrue(content.contains("Leopard 1"));
        assertTrue(content.contains("roles="));
        assertTrue(content.contains("地图语义数据不可用"));
    }

    @Test
    void systemPromptBansResultReferenceAndRequiresJson() {
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT.contains("严禁引用"));
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT.contains("JSON"));
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT.contains("TEAM_A"));
    }
}
