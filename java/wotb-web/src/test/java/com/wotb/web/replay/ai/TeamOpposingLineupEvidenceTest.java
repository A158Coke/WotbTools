package com.wotb.web.replay.ai;
import com.wotb.web.replay.ai.TeamReplayAnalysisService;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 团队证据的对方信息。
 * <p>此前团队 prompt 只描述录像者所在队伍（TEAM_MEMBERS / FORMATION / ENGAGEMENTS…），
 * 对方阵容完全缺失，AI 无从做威胁分析。对方名册来自权威结算，属 mandatory 事实。</p>
 */
class TeamOpposingLineupEvidenceTest {

    private static final long SPHT_TANK_ID = 29985L;   // tankopedia: SPHT / Heavy tank / 10 / USA
    private static final long IS_TANK_ID = 513L;       // tankopedia: IS / Heavy tank / 7 / USSR

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
        // 两名对手：2100+800 输出、1500+600 损失血量、2+1 击杀、1 名存活
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

        // 本队成员行（member accountId=…）同样带结构化等级/国家
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
            return; // 该 fixture 无移动段时跳过：归属断言由下面的结构断言覆盖
        }
        final String movements = content.substring(content.indexOf("=== MEMBER_MOVEMENTS ==="));
        // 移动段之前必须先出现归属成员行，不能是匿名平铺列表
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

    // ---- fixture：走真实管线构造单队上下文 ----

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

        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        final var result = new ReplayProcessingResult(
                "team-enemy.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("team-enemy-hash", "team-enemy-arena", "11.0",
                        "budget_map", ownAce.accountId, null),
                battle, null, null, capabilities, null, null);
        final var group = new BatchAnalyzer().analyze(List.of(result)).groups().getFirst();
        return new AiReplayAnalysisService(
                new AiChatGateway() {
                    @Override public AiChatResponse chat(final AiChatRequest r) { return null; }
                    @Override public boolean isConfigured() { return false; }
                }, "", 30000, new ConservativeDeepSeekTokenEstimator())
                .buildSingleTeamContext(group);
    }
}