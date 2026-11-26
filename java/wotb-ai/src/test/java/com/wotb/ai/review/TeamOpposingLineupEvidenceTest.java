package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamOpposingLineupEvidenceTest {

    private static final long SPHT_TANK_ID = 29985L;
    private static final long IS_TANK_ID = 513L;

    @Test
    void opposingTeamLineupIsPresentWithAuthoritativePerVehicleFacts() {
        final String content = TeamAiPromptBuilder.single(context()).content();

        assertTrue(content.contains("OPPOSING_TEAM_LINEUP_AUTHORITATIVE（对方阵容·权威结算）"), content);
        assertTrue(content.contains("tank=\"SPHT\""), content);
        assertTrue(content.contains("vehicleClass=Heavy tank"), content);
        assertTrue(content.contains("tier=10"), content);
        assertTrue(content.contains("nation=USA"), content);
        assertTrue(content.contains("finalDamage=2100"), content);
        assertTrue(content.contains("damageReceived=1500"), content);
        assertTrue(content.contains("assisted=300"), content);
        assertTrue(content.contains("blocked=900"), content);
        assertTrue(content.contains("hits=12"), content);
        assertTrue(content.contains("penetrations=9"), content);
        assertTrue(content.contains("enemiesDamaged=4"), content);
    }

    @Test
    void opposingTeamAggregateSumsAuthoritativeNumbers() {
        final String content = TeamAiPromptBuilder.single(context()).content();

        assertTrue(content.contains("OPPOSING_TEAM_AUTHORITATIVE_RESULT（对方合计·权威结算）"), content);
        assertTrue(content.contains("opponentCount=2"), content);
        assertTrue(content.contains("finalDamage=2900"), content);
        assertTrue(content.contains("damageReceived=2100"), content);
        assertTrue(content.contains("kills=3"), content);
        assertTrue(content.contains("survivors=1"), content);
    }

    @Test
    void opposingLineupNeverInfersTypeFromTankName() {
        final String content = TeamAiPromptBuilder.single(context()).content();

        assertFalse(content.contains("自行火炮"), content);
        assertFalse(content.contains("SPG"), content);
    }

    @Test
    void ownMembersAlsoCarryStructuredTierAndNation() {
        final String content = TeamAiPromptBuilder.single(context()).content();

        final int memberIdx = content.indexOf("member accountId=");
        assertTrue(memberIdx >= 0, content);
        final String memberLine = content.substring(memberIdx, content.indexOf('\n', memberIdx));
        assertTrue(memberLine.contains("vehicleClass="), memberLine);
        assertTrue(memberLine.contains("tier="), memberLine);
        assertTrue(memberLine.contains("nation="), memberLine);
    }

    @Test
    void memberMovementsAreAttributedToTheirOwner() {
        final String content = TeamAiPromptBuilder.single(context()).content();

        if (!content.contains("=== MEMBER_MOVEMENTS ===")) {
            return;
        }
        final String movements = content.substring(content.indexOf("=== MEMBER_MOVEMENTS ==="));
        final int firstMovement = movements.indexOf("  movement[");
        final int firstMember = movements.indexOf("member accountId=");
        assertTrue(firstMember >= 0 && firstMember < firstMovement, movements);
    }

    @Test
    void teamPromptRequiresOpposingLineupAnalysis() {
        final String prompt = TeamReplayAnalysisService.SINGLE_TEAM_PROMPT;
        assertTrue(prompt.contains("对方关键威胁是【可选】内容"), prompt);
        assertTrue(prompt.contains("只有对核心复盘确有价值时才指出 1-3 辆对方关键威胁"), prompt);
        assertTrue(prompt.contains("OPPOSING_TEAM_LINEUP_AUTHORITATIVE"), prompt);
        assertTrue(prompt.contains("对方关键威胁（可选）"), prompt);
        assertFalse(prompt.contains("分析对方阵容并指出对方主要威胁车辆"),
                "团队复盘不得保留无条件 mandatory 威胁规则");
        assertFalse(prompt.contains("对方数据缺失时明确说明"),
                "团队复盘不得强制缺失数据 disclaimer");
        assertFalse(prompt.contains("对方阵容逐车分析"), "团队复盘不得强制逐车作文");
    }


    private static SingleTeamBattleAnalysisContext context() {
        final List<PlayerResult> players = new ArrayList<>();

        final PlayerResult ownAce = new PlayerResult();
        ownAce.accountId = 10_001L;
        ownAce.nickname = "OwnAce";
        ownAce.team = 1;
        ownAce.tankId = IS_TANK_ID;
        ownAce.damageDealt = 1_800;
        ownAce.survived = true;
        players.add(ownAce);

        final PlayerResult enemyAce = new PlayerResult();
        enemyAce.accountId = 20_001L;
        enemyAce.nickname = "EnemyAce";
        enemyAce.team = 2;
        enemyAce.tankId = SPHT_TANK_ID;
        enemyAce.damageDealt = 2_100;
        enemyAce.damageReceived = 1_500;
        enemyAce.damageAssisted = 300;
        enemyAce.damageBlocked = 900;
        enemyAce.kills = 2;
        enemyAce.nHitsDealt = 12;
        enemyAce.nPenetrationsDealt = 9;
        enemyAce.nEnemiesDamaged = 4;
        enemyAce.survived = true;
        players.add(enemyAce);

        final PlayerResult enemySecond = new PlayerResult();
        enemySecond.accountId = 20_002L;
        enemySecond.nickname = "EnemyTwo";
        enemySecond.team = 2;
        enemySecond.tankId = IS_TANK_ID;
        enemySecond.damageDealt = 800;
        enemySecond.damageReceived = 600;
        enemySecond.kills = 1;
        enemySecond.survived = false;
        players.add(enemySecond);

        final Battle battle = new Battle();
        battle.arenaId = "team-enemy-arena";
        battle.mapName = "budget_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.players = players;
        battle.recorder = ownAce.nickname;

        return TeamContextBuilder.buildSingleTeamContext(battle, null);
    }
}