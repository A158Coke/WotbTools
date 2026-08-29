package com.wotb.web.replay;

import com.wotb.core.league.LeagueRatingCalculator;
import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.LeagueRatingValidator;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.league.PlayerLeagueRating;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.PickleReader;
import com.wotb.core.parse.Protobuf;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实训练赛/CW 7v7 名册完整性收口：
 * 名册 #201=15（14 combatant + 1 non-combatant）/ 结算 #301=14 必须
 * Parser→Validator→Calculator 全链路通过，产出 14 个 Player Rating、七维度、
 * Team 1/2 Rating、MVP、两队最佳；同时证明<b>全局 Battle.rosterComplete 不被弱化</b>
 * （extra 存在时保持严格 fail-closed，AI 推断不受影响）。
 */
class LeagueRosterCompletenessTest {

    private static final String REAL_FIXTURE_15_14 =
            "fixtures/replays/cw-training-15-14-example.wotbreplay";
    private static final String REAL_FIXTURE_14_14 =
            "fixtures/replays/tournament-14-14-example.wotbreplay";

    @Test
    void realTrainingShapeRosterExtraParsesAndRates() throws Exception {
        // probe shape：名册 #201 额外 non-combatant 账号 3117047709（不结算）
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "9036183479040937";
        battle.arenaBonusType = 2;
        final byte[] bytes = LeagueTestReplays.replayBytes(battle, 2, List.of(3117047709L));

        final Battle parsed = ReplayParser.parse(bytes);
        assertEquals(14, parsed.players.size());
        // 全局 rosterComplete 保持严格 fail-closed（#201 extra → false，AI 不放松）
        assertEquals(Boolean.FALSE, parsed.rosterComplete,
                "全局 rosterComplete 不得因 League 修复被扩大为 true");
        // League 专属证据完整 → Validator PASS
        assertEquals(Boolean.TRUE, parsed.settlementAccountsCoveredByRoster);
        assertEquals(Boolean.TRUE, parsed.settlementRosterTeamConsistent);
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty(),
                "合法 7v7 训练房必须通过 LeagueRatingValidator");

        final LeagueRatingResult result = LeagueRatingCalculator.calculate(parsed);
        assertEquals(14, result.players().size());
        for (final PlayerLeagueRating p : result.players()) {
            assertTrue(p.finalRating() >= 0 && p.finalRating() <= PlayerLeagueRating.MAX_FINAL,
                    "总 Rating 必须在 0-1000 范围: " + p.finalRating());
            // 七维度全部产生且不越界
            assertTrue(p.damageScore() >= 0 && p.damageScore() <= PlayerLeagueRating.MAX_DAMAGE, "damage 维度越界");
            assertTrue(p.assistScore() >= 0 && p.assistScore() <= PlayerLeagueRating.MAX_ASSIST, "assist 维度越界");
            assertTrue(p.killScore() >= 0 && p.killScore() <= PlayerLeagueRating.MAX_KILL, "kill 维度越界");
            assertTrue(p.exchangeScore() >= 0 && p.exchangeScore() <= PlayerLeagueRating.MAX_EXCHANGE, "exchange 维度越界");
            assertTrue(p.blockedScore() >= 0 && p.blockedScore() <= PlayerLeagueRating.MAX_BLOCKED, "blocked 维度越界");
            assertTrue(p.survivalTradeScore() >= 0 && p.survivalTradeScore() <= PlayerLeagueRating.MAX_SURVIVAL_TRADE, "survival 维度越界");
            assertTrue(p.shootingScore() >= 0 && p.shootingScore() <= PlayerLeagueRating.MAX_SHOOTING, "shooting 维度越界");
        }
        assertNotNull(result.team1(), "Team 1 Rating 必须存在");
        assertNotNull(result.team2(), "Team 2 Rating 必须存在");
        assertNotNull(result.mvp(), "MVP 必须存在");
        assertNotNull(result.team1().teamBest(), "Team 1 最佳必须存在");
        assertNotNull(result.team2().teamBest(), "Team 2 最佳必须存在");
        assertTrue(result.rated());
    }

    /**
     * 真实 CW/Training fixture（common/fixtures/replays/ 入库，CI 无条件执行）——
     * 真实 15/14 shape（#201=15 / #301=14，probe 已验证）全链路：Parser → Validator →
     * Calculator，断言 14 Player Ratings、七维度、Team 1/2、MVP、两队最佳。
     */
    @Test
    void realFixture15v14ParsesAndRates() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        final Path file = common.resolve(REAL_FIXTURE_15_14);
        assertTrue(Files.exists(file), "真实 15/14 fixture 必须入库: " + REAL_FIXTURE_15_14);

        final Battle parsed = ReplayParser.parse(Files.readAllBytes(file));
        assertTrue(LeagueRatingMode.isLeague(parsed.arenaBonusType),
                "真实 CW fixture arenaBonusType 必须属于 League（2/4），实际=" + parsed.arenaBonusType);
        assertSettlementStructure(parsed);
        // 真实 shape：#201 > #301（名册含 non-combatant extra）
        final int[] counts = rosterResultCounts(file);
        assertTrue(counts[0] > counts[1],
                "真实 fixture 必须满足 #201 > #301（#201=" + counts[0] + " #301=" + counts[1] + "）");
        // 全局 rosterComplete 保持严格 fail-closed（extra 存在 → false），League 专属证据完整 → PASS
        assertEquals(Boolean.FALSE, parsed.rosterComplete,
                "真实 15/14 CW 的全局 rosterComplete 必须保持严格（不扩大为 true）");
        assertEquals(Boolean.TRUE, parsed.settlementAccountsCoveredByRoster);
        assertEquals(Boolean.TRUE, parsed.settlementRosterTeamConsistent);
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty(),
                "真实 CW 15/14 必须通过 LeagueRatingValidator");

        final LeagueRatingResult result = LeagueRatingCalculator.calculate(parsed);
        assertRateResultComplete(result);
    }

    /**
     * 真实 Tournament 14/14 fixture（入库，CI 无条件执行）——Tournament/CW 验收。
     */
    @Test
    void realFixture14v14ParsesAndRates() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        final Path file = common.resolve(REAL_FIXTURE_14_14);
        assertTrue(Files.exists(file), "真实 14/14 fixture 必须入库: " + REAL_FIXTURE_14_14);

        final Battle parsed = ReplayParser.parse(Files.readAllBytes(file));
        assertTrue(LeagueRatingMode.isLeague(parsed.arenaBonusType),
                "真实 Tournament fixture arenaBonusType 必须属于 League（2/4）");
        assertSettlementStructure(parsed);
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty(),
                "真实 Tournament 14/14 必须通过 LeagueRatingValidator");
        assertRateResultComplete(LeagueRatingCalculator.calculate(parsed));
    }

    /**
     * 两份真实 CW fixture 端到端批次（collect → battleResults / summaries 非空）。
     */
    @Test
    void realFixturesBatchCollectProducesSummaries() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        final List<Source> sources = new ArrayList<>();
        for (final String rel : List.of(REAL_FIXTURE_15_14, REAL_FIXTURE_14_14)) {
            final Path file = common.resolve(rel);
            assertTrue(Files.exists(file), "fixture 必须入库: " + rel);
            sources.add(new Source(file.getFileName().toString(), Files.readAllBytes(file)));
        }
        final LeagueReplays.LeagueCollectResult r = LeagueReplays.collect(
                sources, source -> ReplayParser.parse(source.bytes()), null, null);
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertFalse(r.leagueBatch().battleResults().isEmpty(),
                "真实 CW 批次 battleResults 必须非空");
        assertFalse(r.leagueBatch().playerSummaries().isEmpty(),
                "真实 CW 批次 playerSummaries 必须非空");
        assertFalse(r.leagueBatch().teamSummaries().isEmpty(),
                "真实 CW 批次 teamSummaries 必须非空");
    }

    /**
     * AI Regression：CW 15/14 的全局 rosterComplete 保持严格（false）→ FriendlyEnemyResult
     * 不因 League 修复而放松 fail-closed——不推导点数/存活结束方式、不产生全歼推断
     * （PR #73 AI fail-closed boundary 不受影响）。
     */
    @Test
    void aiFailClosedBoundaryPreservedForCwRosterExtra() throws Exception {
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "111";
        battle.arenaBonusType = 2;
        final byte[] bytes = LeagueTestReplays.replayBytes(battle, 2, List.of(3117047709L));
        final Battle parsed = ReplayParser.parse(bytes);
        // 全局严格契约：extra 存在 → rosterComplete=false（不扩大为 true）
        assertEquals(Boolean.FALSE, parsed.rosterComplete,
                "CW 15/14 的全局 rosterComplete 必须保持严格（AI fail-closed 不放松）");
        // League Rating 仍可用（League 专属证据完整）
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty());

        // FriendlyEnemyResult：双方均有存活 + winnerTeam 明确 → BATTLE_RESULTS 胜方，
        // 但结束方式不得因 roster 不完整而推导（pointsEndReason=UNKNOWN）
        final FriendlyEnemyResult.TeamBattleWinner tbw =
                FriendlyEnemyResult.resolveTeamBattle(parsed, 1);
        assertEquals(FriendlyEnemyResult.WinnerSource.BATTLE_RESULTS, tbw.source(),
                "winnerTeam 明确时胜方来源仍为 BATTLE_RESULTS");
        assertEquals(FriendlyEnemyResult.PointsEndReason.UNKNOWN, tbw.pointsEndReason(),
                "rosterComplete=false 时禁止用点数/存活推导结束方式（AI fail-closed 保持）");
        // 全歼后缀：rosterComplete=false → 不输出全歼推断
        final FriendlyEnemyResult.Winner winner = FriendlyEnemyResult.resolve(parsed);
        assertEquals("", FriendlyEnemyResult.annihilationSuffix(parsed, 1, winner),
                "rosterComplete=false 时禁止全歼推断（不把未知当零存活）");
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
        assertEquals(Boolean.FALSE, parsed.rosterComplete,
                "真实训练房（#201=15/#301=14）全局 rosterComplete 保持严格（AI fail-closed 不放松）");
        assertTrue(LeagueRatingValidator.validate(parsed).isEmpty(),
                "真实训练房必须通过 LeagueRatingValidator（不得 LEAGUE_ROSTER_INCOMPLETE）");
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(parsed);
        assertEquals(14, result.players().size());
        assertNotNull(result.mvp());
        assertNotNull(result.team1());
        assertNotNull(result.team2());
    }

    /** 标准 7v7 结算结构断言（14 人 / 7+7 / 14 unique accounts）。 */
    private static void assertSettlementStructure(final Battle parsed) {
        assertEquals(14, parsed.players.size(), "结算必须有 14 人");
        final Set<Long> accounts = new TreeSet<>();
        int team1 = 0;
        int team2 = 0;
        for (final com.wotb.core.model.PlayerResult p : parsed.players) {
            accounts.add(p.accountId);
            if (p.team == 1) {
                team1++;
            } else if (p.team == 2) {
                team2++;
            }
        }
        assertEquals(14, accounts.size(), "14 个 unique accountId");
        assertEquals(7, team1, "team1 == 7");
        assertEquals(7, team2, "team2 == 7");
    }

    /** 解码 battle_results.dat 统计 #201 / #301 条目数（真实 fixture 计数断言用）。 */
    private static int[] rosterResultCounts(final Path file) throws Exception {
        final Map<String, byte[]> entries = ReplayArchiveReader.read(Files.readAllBytes(file));
        final Object pickle = PickleReader.loads(entries.get("battle_results.dat"));
        final byte[] pb = (byte[]) ((Object[]) pickle)[1];
        final Map<Integer, List<Object>> root = Protobuf.decode(pb);
        return new int[]{root.getOrDefault(201, List.of()).size(),
                root.getOrDefault(301, List.of()).size()};
    }

    /** Rating 结果完整性断言：14 个 PlayerRating、七维度范围、Team 1/2、MVP、两队最佳。 */
    private static void assertRateResultComplete(final LeagueRatingResult result) {
        assertEquals(14, result.players().size());
        for (final PlayerLeagueRating p : result.players()) {
            assertTrue(p.finalRating() >= 0 && p.finalRating() <= PlayerLeagueRating.MAX_FINAL,
                    "总 Rating 必须在 0-1000 范围: " + p.finalRating());
            assertTrue(p.damageScore() >= 0 && p.damageScore() <= PlayerLeagueRating.MAX_DAMAGE, "damage 维度越界");
            assertTrue(p.assistScore() >= 0 && p.assistScore() <= PlayerLeagueRating.MAX_ASSIST, "assist 维度越界");
            assertTrue(p.killScore() >= 0 && p.killScore() <= PlayerLeagueRating.MAX_KILL, "kill 维度越界");
            assertTrue(p.exchangeScore() >= 0 && p.exchangeScore() <= PlayerLeagueRating.MAX_EXCHANGE, "exchange 维度越界");
            assertTrue(p.blockedScore() >= 0 && p.blockedScore() <= PlayerLeagueRating.MAX_BLOCKED, "blocked 维度越界");
            assertTrue(p.survivalTradeScore() >= 0 && p.survivalTradeScore() <= PlayerLeagueRating.MAX_SURVIVAL_TRADE, "survival 维度越界");
            assertTrue(p.shootingScore() >= 0 && p.shootingScore() <= PlayerLeagueRating.MAX_SHOOTING, "shooting 维度越界");
        }
        assertNotNull(result.team1(), "Team 1 Rating 必须存在");
        assertNotNull(result.team2(), "Team 2 Rating 必须存在");
        assertNotNull(result.mvp(), "MVP 必须存在");
        assertNotNull(result.team1().teamBest(), "Team 1 最佳必须存在");
        assertNotNull(result.team2().teamBest(), "Team 2 最佳必须存在");
        assertTrue(result.rated());
    }
}
