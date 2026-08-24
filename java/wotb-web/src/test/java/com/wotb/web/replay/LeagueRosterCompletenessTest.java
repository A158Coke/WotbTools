package com.wotb.web.replay;

import com.wotb.core.league.LeagueRatingCalculator;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.LeagueRatingValidator;
import com.wotb.core.league.PlayerLeagueRating;
import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实训练赛/CW 7v7 名册完整性收口（plan §6/§7/§14-§17）：
 * 真实结构 shape（probe 20260725_1535 训练房）名册 #201=15（14 combatant + 1 non-combatant）
 * 结算 #301=14 必须 Parser→Validator→Calculator 全链路通过，产出 14 个 Player Rating、
 * 八维度、Team 1/2 Rating、MVP、两队最佳。
 */
class LeagueRosterCompletenessTest {

    @Test
    void realTrainingShapeRosterExtraParsesAndRates() throws Exception {
        // probe shape：名册 #201 额外 non-combatant 账号 3117047709（观战者，不结算）
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "9036183479040937";
        battle.arenaBonusType = 2;
        final byte[] bytes = LeagueTestReplays.replayBytes(battle, 2, List.of(3117047709L));

        final Battle parsed = ReplayParser.parse(bytes);
        assertEquals(14, parsed.players.size());
        assertTrue(Boolean.TRUE.equals(parsed.rosterComplete),
                "名册 extra non-combatant 不得导致结算阵容不完整（ActualCombatantSet == #301）");
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty(),
                "合法 7v7 训练房必须通过 LeagueRatingValidator");

        final LeagueRatingResult result = LeagueRatingCalculator.calculate(parsed);
        assertEquals(14, result.players().size());
        for (final PlayerLeagueRating p : result.players()) {
            assertTrue(p.finalRating() >= 0 && p.finalRating() <= PlayerLeagueRating.MAX_FINAL,
                    "总 Rating 必须在 0-1000 范围: " + p.finalRating());
            // 八维度全部产生且不越界
            assertTrue(p.damageScore() >= 0 && p.damageScore() <= PlayerLeagueRating.MAX_DAMAGE, "damage 维度越界");
            assertTrue(p.assistScore() >= 0 && p.assistScore() <= PlayerLeagueRating.MAX_ASSIST, "assist 维度越界");
            assertTrue(p.killScore() >= 0 && p.killScore() <= PlayerLeagueRating.MAX_KILL, "kill 维度越界");
            assertTrue(p.exchangeScore() >= 0 && p.exchangeScore() <= PlayerLeagueRating.MAX_EXCHANGE, "exchange 维度越界");
            assertTrue(p.blockedScore() >= 0 && p.blockedScore() <= PlayerLeagueRating.MAX_BLOCKED, "blocked 维度越界");
            assertTrue(p.survivalTradeScore() >= 0 && p.survivalTradeScore() <= PlayerLeagueRating.MAX_SURVIVAL_TRADE, "survival 维度越界");
            assertTrue(p.shootingScore() >= 0 && p.shootingScore() <= PlayerLeagueRating.MAX_SHOOTING, "shooting 维度越界");
            assertTrue(p.objectiveScore() >= 0 && p.objectiveScore() <= PlayerLeagueRating.MAX_OBJECTIVE, "objective 维度越界");
        }
        assertNotNull(result.team1(), "Team 1 Rating 必须存在");
        assertNotNull(result.team2(), "Team 2 Rating 必须存在");
        assertNotNull(result.mvp(), "MVP 必须存在");
        assertNotNull(result.team1().teamBest(), "Team 1 最佳必须存在");
        assertNotNull(result.team2().teamBest(), "Team 2 最佳必须存在");
        assertTrue(result.rated());
    }

    /**
     * 本地真实训练房样本自动验证（common/data gitignore 本地样本；缺失自动跳过，
     * 有样本时强制断言 Rating 全链路可用——用户批次 0/30 的直接回归证据）。
     */
    @Test
    void probeRealTrainingReplayRatesWhenPresent() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        final Path file = common.resolve(
                "data/20260725_1535__CHRD-A158布丁_A178_SPHT_9036183479040937(2).wotbreplay");
        if (!Files.exists(file)) {
            return;
        }
        final Battle parsed = ReplayParser.parse(Files.readAllBytes(file));
        assertEquals(2, parsed.arenaBonusType, "真实训练房 arenaBonusType=2");
        assertEquals(14, parsed.players.size());
        assertTrue(Boolean.TRUE.equals(parsed.rosterComplete),
                "真实训练房（#201=15/#301=14）必须被判定为结算阵容完整");
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty(),
                "真实训练房必须通过 LeagueRatingValidator（不得 LEAGUE_ROSTER_INCOMPLETE）");
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(parsed);
        assertEquals(14, result.players().size());
        assertNotNull(result.mvp());
        assertNotNull(result.team1());
        assertNotNull(result.team2());
    }
}
