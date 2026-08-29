package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 模式判定 / 去重 / 冲突 / 校验失败（§4、§21.3）。 */
class LeagueReplaysTest {

    private static Source source(final String name, final Battle battle, final int arenaBonusType) throws Exception {
        return new Source(name, LeagueTestBattles.replayBytes(battle, arenaBonusType));
    }

    private static Source source(final String name, final Battle battle, final int arenaBonusType,
                                 final List<Long> extraRosterAccounts) throws Exception {
        return new Source(name, LeagueTestBattles.replayBytes(battle, arenaBonusType, extraRosterAccounts));
    }

    private static LeagueReplays.LeagueCollectResult collect(final List<Source> sources) {
        return LeagueReplays.collect(sources, source -> ReplayParser.parse(source.bytes()), null, null);
    }

    @Test
    void singleTrainingBattleIsLeagueRated() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "111";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("a.wotbreplay", battle, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueBatch().battleResults().size());
        assertTrue(r.leagueBatch().battleResults().getFirst().rated());
    }

    @Test
    void tournamentBattleIsLeagueRated() throws Exception {
        final Battle battle = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("b.wotbreplay", battle, 4)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
    }

    @Test
    void standardRandomBattleHasNoLeagueRating() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "333";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("c.wotbreplay", battle, 1)));
        assertEquals(LeagueRatingMode.STANDARD_REPLAY, r.mode());
        assertEquals(1, r.battles().size());
        assertNull(r.leagueBatch());
    }

    @Test
    void inGameRatingBattleIsStandard() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "444";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("d.wotbreplay", battle, 7)));
        assertEquals(LeagueRatingMode.STANDARD_REPLAY, r.mode());
        assertNull(r.leagueBatch());
    }

    @Test
    void trainingPlusTournamentBatchAllowed() throws Exception {
        final Battle t = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        t.arenaId = "111";
        final Battle t2 = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        t2.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("t.wotbreplay", t, 2), source("t2.wotbreplay", t2, 4)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size());
        assertEquals(2, r.leagueBatch().battleResults().size());
    }

    @Test
    void trainingPlusRandomIsMixedKeepsParsedBattles() throws Exception {
        // 混合批次不再整体拒绝——League Rating 不聚合，但全部可解析
        // replay 仍按普通回放语义成功返回（battles 保留、无 leagueBatch、progress 真实 outcome）。
        final Battle t = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        t.arenaId = "111";
        final Battle rand = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        rand.arenaId = "999";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("t.wotbreplay", t, 2), source("r.wotbreplay", rand, 1)));
        assertEquals(LeagueRatingMode.MIXED_UNSUPPORTED, r.mode());
        assertEquals(2, r.battles().size(), "混合批次所有可解析 Battle 必须保留（禁止污染 Parser）");
        assertNull(r.leagueBatch(), "混合批次不产生 League Rating");
        assertTrue(r.leagueFailures().isEmpty());
        // 每个文件恰好一次 progress；已解析文件必须 SUCCESS（不得计为解析失败）
        final List<String> outcomes = new ArrayList<>();
        LeagueReplays.collect(List.of(source("t.wotbreplay", t, 2), source("r.wotbreplay", rand, 1)),
                source -> ReplayParser.parse(source.bytes()), null,
                (index, name, o) -> outcomes.add(name + ":" + o));
        assertEquals(2, outcomes.size());
        assertTrue(outcomes.stream().allMatch(o -> o.endsWith(":SUCCESS")));
    }

    @Test
    void sameArenaConsistentCopiesDeduplicate() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "111";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("a.wotbreplay", battle, 2), source("a2.wotbreplay", battle, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.duplicates().size());
        assertTrue(r.leagueFailures().isEmpty());
    }

    @Test
    void sameArenaConflictingCopiesRejected() throws Exception {
        final Battle a = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        a.arenaId = "111";
        final Battle b = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b.arenaId = "111";
        b.winnerTeam = 2; // 关键事实冲突
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("a.wotbreplay", a, 2), source("b.wotbreplay", b, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertTrue(r.battles().isEmpty());
        assertEquals(2, r.leagueFailures().size());
        assertTrue(r.leagueFailures().stream()
                .allMatch(f -> f.code().equals(LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA)));
    }

    @Test
    void trainingRosterWithExtraNonCombatantStillRated() throws Exception {
        // probe shape（20260725_1535 训练房）：名册 #201=15（14 combatant + 1 extra non-combatant），
        // 结算 #301=14。extra 只写名册不写结算 → parser rosterComplete=true → Rating 通过
        // （ActualCombatantSet == #301；名册 extra ≠ 缺失的结算队员）。
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "111";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("a.wotbreplay", battle, 2, List.of(3117047709L))));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueBatch().battleResults().size());
        assertTrue(r.leagueBatch().battleResults().getFirst().rated());
        assertTrue(r.leagueFailures().isEmpty(), "名册 extra non-combatant 不得导致 ROSTER_INCOMPLETE");
    }

    @Test
    void multipleValidLeagueReplaysProduceSummaries() throws Exception {
        // 真实批量：N>=2 份合法 League 回放 → playerSummaries / teamSummaries 非空
        final Battle t1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        t1.arenaId = "111";
        final Battle t2 = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        t2.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("t1.wotbreplay", t1, 2, List.of(999_999L)),
                source("t2.wotbreplay", t2, 4, List.of(888_888L))));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.leagueBatch().battleResults().size());
        assertTrue(r.leagueFailures().isEmpty());
        assertFalse(r.leagueBatch().playerSummaries().isEmpty(), "多场合法 CW playerSummaries 必须非空");
        assertFalse(r.leagueBatch().teamSummaries().isEmpty(), "多场合法 CW teamSummaries 必须非空");
    }

    @Test
    void invalidSevenVsSevenReportedAsFailureOthersContinue() throws Exception {
        final Battle bad = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        bad.arenaId = "111";
        bad.players.remove(0); // 13 人
        final Battle good = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        good.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("bad.wotbreplay", bad, 2), source("good.wotbreplay", good, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size(), "Rating 校验失败的场次必须保留在 battles（领域分离，P0）");
        assertTrue(r.battles().stream().anyMatch(b -> b.arenaId.equals("111")),
                "bad 场（13 人）必须仍存在于 battles");
        assertEquals(1, r.leagueBatch().battleResults().size(), "Rating 只对 eligible 场次计算");
        assertEquals(1, r.leagueFailures().size());
        assertEquals(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN, r.leagueFailures().getFirst().code());
        assertEquals("bad.wotbreplay", r.leagueFailures().getFirst().fileName());
    }

    // ---- P0 回归：replay parsing validity != league rating eligibility ----
    // 直接 loader 返回构造好的 Battle（绕过 parser 字节往返），精确测试校验/保留/评分语义。

    private static LeagueReplays.LeagueCollectResult collectBattles(final List<Battle> battles) {
        final List<Source> sources = new ArrayList<>();
        for (int i = 0; i < battles.size(); i++) {
            sources.add(new Source("r" + i + ".wotbreplay", new byte[]{(byte) i}));
        }
        return LeagueReplays.collect(sources, source -> {
            final int idx = Integer.parseInt(source.name().substring(1, source.name().indexOf('.')));
            return battles.get(idx);
        }, null, null);
    }

    @Test
    void caseA_allParsedAndAllEligible() throws Exception {
        final Battle a = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        a.arenaId = "111";
        final Battle b = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        b.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(a, b));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size());
        assertEquals(2, r.leagueBatch().battleResults().size());
        assertEquals(0, r.leagueFailures().size());
        assertTrue(r.leagueBatch().battleResults().stream().allMatch(LeagueRatingResult::rated));
    }

    @Test
    void caseB_partialRatingIneligibleBattleKeptWithFailure() throws Exception {
        final Battle good = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        good.arenaId = "111";
        final Battle bad = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        bad.arenaId = "222";
        bad.settlementAccountsCoveredByRoster = false; // ROSTER_INCOMPLETE
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(good, bad));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size(), "Rating 不合格的 Battle 必须保留在解析结果");
        assertEquals(2, r.battleSourceNames().size());
        assertTrue(r.battles().stream().anyMatch(b -> b.arenaId.equals("222")),
                "bad 场必须仍存在于 battles");
        assertEquals(1, r.leagueBatch().battleResults().size(), "Rating 只对 eligible 场次计算");
        assertEquals(1, r.leagueFailures().size());
        assertEquals(LeagueFailure.Code.ROSTER_INCOMPLETE, r.leagueFailures().getFirst().code());
        assertEquals("r1.wotbreplay", r.leagueFailures().getFirst().fileName());
    }

    @Test
    void caseC_allRatingIneligibleAllBattlesStillParsed() throws Exception {
        // ROSTER_INCOMPLETE + NO_DECISIVE_WINNER：全部 Rating 不合格时所有 Battle 仍必须保留
        final Battle roster = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        roster.arenaId = "222";
        roster.settlementAccountsCoveredByRoster = false;
        final Battle winner = LeagueTestBattles.battle(null, LeagueTestBattles.defaultSevenVsSeven());
        winner.arenaId = "333";
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(roster, winner));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size(), "全部 Rating 不合格时所有 Battle 仍必须保留（禁止 NO_VALID_REPLAYS）");
        assertEquals(0, r.leagueBatch().battleResults().size());
        assertEquals(2, r.leagueFailures().size());
        assertTrue(r.leagueFailures().stream().anyMatch(f -> f.code().equals(LeagueFailure.Code.ROSTER_INCOMPLETE)));
        assertTrue(r.leagueFailures().stream().anyMatch(f -> f.code().equals(LeagueFailure.Code.NO_DECISIVE_WINNER)));
    }

    @Test
    void unknownDeathTimeBattleIsRatedWithQualityWarning() throws Exception {
        // 死亡时间 UNKNOWN（survivalTimeSec == 0）不再是 battle-level failure：
        // 该场照常评分，仅计入非阻断 quality limitation（UNKNOWN != INVALID）
        final List<LeagueTestBattles.PlayerSpec> deathSpecs = LeagueTestBattles.defaultSevenVsSeven();
        deathSpecs.getFirst().dead(0);
        final Battle death = LeagueTestBattles.battle(1, deathSpecs);
        death.arenaId = "111";
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(death));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueBatch().battleResults().size(), "UNKNOWN 死亡场照常评分");
        assertTrue(r.leagueFailures().isEmpty(), "UNKNOWN 不是 failure");
        assertEquals(1, r.leagueBatch().ratingQuality().unknownDeathTimePlayers(),
                "UNKNOWN 死亡玩家计入非阻断 quality limitation");
    }

    @Test
    void unknownPlusKnownReconciledDeterministicallyRegardlessOfUploadOrder() {
        // 同一 arenaId 两份一致副本：玩家 1001 死亡时间一份 UNKNOWN(0)、一份 KNOWN 128.12；
        // 敌方 2001 在两份中都于 132.0s 阵亡——PR147 §C precision-aware：SETTLEMENT_SECOND ±0.5s 量化，
        // 该值区间 [131.5,132.5] 确定性落在玩家 [128.12, 133.12] 窗口内（enemy_min>=player_max）→ TRADE；
        // 原本 128.5 在 ±0.5 区间下与玩家 128.12 为 ambiguous（敌方可能 128.0<玩家）→ fails closed，不再用 midpoint 强判。
        // UNKNOWN+KNOWN 不是 conflict；canonical 使用 KNOWN；上传顺序不影响最终 Rating。
        // 每个顺序必须用<b>全新构造</b>的 Battle（上一轮 canonicalization 会原地 mutate
        // 保留副本的 survivalTimeSec——复用对象会让第二顺序变成 KNOWN+KNOWN，测不出顺序独立性）。
        final LeagueReplays.LeagueCollectResult r1 = collectBattles(List.of(
                unknownCopy(132.0), knownCopy(128.12, 132.0)));
        final LeagueReplays.LeagueCollectResult r2 = collectBattles(List.of(
                knownCopy(128.12, 132.0), unknownCopy(132.0)));

        for (final LeagueReplays.LeagueCollectResult r : List.of(r1, r2)) {
            assertTrue(r.leagueFailures().isEmpty(),
                    "UNKNOWN + KNOWN 死亡时间不得判 CONFLICTING_REPLAYS_FOR_ARENA");
            assertEquals(1, r.battles().size());
            assertEquals(1, r.leagueBatch().battleResults().size());
            assertEquals(1, r.duplicates().size());
            assertEquals(0, r.leagueBatch().ratingQuality().unknownDeathTimePlayers(),
                    "canonical 使用 KNOWN → 该玩家不计 UNKNOWN quality");
        }
        // canonical 死亡时间 = KNOWN 128.12（保留 battle 的玩家已收口，与顺序无关）
        assertEquals(128.12, r1.battles().getFirst().players.getFirst().survivalTimeSec, 1e-9);
        assertEquals(128.12, r2.battles().getFirst().players.getFirst().survivalTimeSec, 1e-9);

        final LeagueRatingResult rr1 = r1.leagueBatch().battleResults().getFirst();
        final LeagueRatingResult rr2 = r2.leagueBatch().battleResults().getFirst();
        final PlayerLeagueRating p1 = rr1.byAccount(1001);
        final PlayerLeagueRating p2 = rr2.byAccount(1001);
        assertEquals(LeagueRatingCalculator.STATE_TRADE, p1.survivalState(),
                "KNOWN 128.12 死亡后 0..+5s 内确定性存在敌方死亡（132.0）→ TRADE");
        assertEquals(p1.survivalState(), p2.survivalState());
        assertEquals(p1.survivalTradeScore(), p2.survivalTradeScore(), 1e-9);
        assertEquals(p1.finalRating(), p2.finalRating(), 1e-9);
        assertEquals(rr1.players().stream().map(PlayerLeagueRating::finalRating).toList(),
                rr2.players().stream().map(PlayerLeagueRating::finalRating).toList(),
                "上传顺序变化不得改变任何玩家 finalRating");
    }

    @Test
    void unknownPlusUnknownStaysUnknownRatedOnceQualityOne() {
        // 同一 arenaId 两份一致副本：同一阵亡玩家死亡时间都是 UNKNOWN(0)。
        // 不 conflict、只评分一次；canonical 仍 UNKNOWN；quality 只计 canonical battle 的 1 个实例。
        final List<LeagueTestBattles.PlayerSpec> specsA = LeagueTestBattles.defaultSevenVsSeven();
        specsA.getFirst().dead(0);
        final Battle a = LeagueTestBattles.battle(1, specsA);
        a.arenaId = "111";
        final List<LeagueTestBattles.PlayerSpec> specsB = LeagueTestBattles.defaultSevenVsSeven();
        specsB.getFirst().dead(0);
        final Battle b = LeagueTestBattles.battle(1, specsB);
        b.arenaId = "111";

        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(a, b));
        assertTrue(r.leagueFailures().isEmpty(), "UNKNOWN + UNKNOWN 不是 conflict");
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueBatch().battleResults().size(), "只评分一次");
        assertEquals(1, r.duplicates().size());
        assertEquals(0.0, r.battles().getFirst().players.getFirst().survivalTimeSec, 1e-9,
                "canonical 保持 UNKNOWN(0)");
        final PlayerLeagueRating p = r.leagueBatch().battleResults().getFirst().byAccount(1001);
        assertEquals(LeagueRatingCalculator.STATE_NONE, p.survivalState());
        assertEquals(0, p.survivalTradeScore(), 1e-9);
        assertEquals(1, r.leagueBatch().ratingQuality().unknownDeathTimePlayers(),
                "quality 统计 canonical battle 中的玩家实例，不得因两份 duplicate 计成 2");
    }

    @Test
    void knownKnownWithinToleranceCanonicalMinDeterministic() {
        // KNOWN 128.12 vs KNOWN 128.50（≤1s 容差）：不 conflict；canonical = 最小 KNOWN = 128.12，
        // 与上传顺序无关。每个顺序用全新 Battle 实例（canonicalization 原地 mutate 保留副本）。
        final LeagueReplays.LeagueCollectResult r1 = collectBattles(List.of(
                knownCopy(128.12, 300.0), knownCopy(128.50, 300.0)));
        final LeagueReplays.LeagueCollectResult r2 = collectBattles(List.of(
                knownCopy(128.50, 300.0), knownCopy(128.12, 300.0)));
        for (final LeagueReplays.LeagueCollectResult r : List.of(r1, r2)) {
            assertTrue(r.leagueFailures().isEmpty());
            assertEquals(1, r.leagueBatch().battleResults().size());
        }
        assertEquals(128.12, r1.battles().getFirst().players.getFirst().survivalTimeSec, 1e-9);
        assertEquals(128.12, r2.battles().getFirst().players.getFirst().survivalTimeSec, 1e-9);
        assertEquals(r1.leagueBatch().battleResults().getFirst().byAccount(1001).finalRating(),
                r2.leagueBatch().battleResults().getFirst().byAccount(1001).finalRating(), 1e-9);
    }

    // ---- 三副本 group 测试（UNKNOWN 不能隔开互相矛盾的 KNOWN；全新 Battle 每顺序）----

    @Test
    void threeCopiesUnknownKnown100Known128ConflictRegardlessOfOrder() {
        // Case 1：UNKNOWN + KNOWN100 + KNOWN128 —— 100 vs 128 超 1s 容差 → 全部 6 种排列
        // 都必须是 CONFLICTING_REPLAYS_FOR_ARENA（UNKNOWN 不是 wildcard，不能隔开矛盾 KNOWN）。
        final double[][] orders = {
                {0, 100, 128}, {0, 128, 100}, {100, 0, 128},
                {100, 128, 0}, {128, 0, 100}, {128, 100, 0}};
        for (final double[] o : orders) {
            final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(
                    copyWithDeath(o[0]), copyWithDeath(o[1]), copyWithDeath(o[2])));
            assertEquals(0, r.battles().size(), "order " + java.util.Arrays.toString(o));
            assertEquals(3, r.leagueFailures().size());
            assertTrue(r.leagueFailures().stream().allMatch(
                            f -> f.code().equals(LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA)),
                    "order " + java.util.Arrays.toString(o) + " 必须全部 conflict");
            assertEquals(0, r.leagueBatch().battleResults().size());
        }
    }

    @Test
    void threeCopiesUnknownKnown128_12Known128_50RatedSameRegardlessOfOrder() {
        // Case 2：UNKNOWN + KNOWN128.12 + KNOWN128.50 —— KNOWN 互相一致（≤1s）→
        // 全部 6 种排列都不 conflict；canonical = 128.12；最终 Rating 与 ratingQuality 相同。
        final double[][] orders = {
                {0, 128.12, 128.50}, {0, 128.50, 128.12}, {128.12, 0, 128.50},
                {128.12, 128.50, 0}, {128.50, 0, 128.12}, {128.50, 128.12, 0}};
        double lastRating = Double.NaN;
        for (final double[] o : orders) {
            final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(
                    copyWithDeath(o[0]), copyWithDeath(o[1]), copyWithDeath(o[2])));
            assertTrue(r.leagueFailures().isEmpty(), "order " + java.util.Arrays.toString(o)
                    + " 不得 conflict: " + r.leagueFailures());
            assertEquals(1, r.battles().size());
            assertEquals(1, r.leagueBatch().battleResults().size());
            assertEquals(2, r.duplicates().size());
            assertEquals(0, r.leagueBatch().ratingQuality().unknownDeathTimePlayers(),
                    "canonical 使用 KNOWN → 不计 UNKNOWN quality");
            assertEquals(128.12, r.battles().getFirst().players.getFirst().survivalTimeSec, 1e-9,
                    "canonical = min KNOWN（与顺序无关）");
            final double rating = r.leagueBatch().battleResults().getFirst()
                    .byAccount(1001).finalRating();
            if (!Double.isNaN(lastRating)) {
                assertEquals(lastRating, rating, 1e-9, "最终 Rating 与上传顺序无关");
            }
            lastRating = rating;
        }
    }

    @Test
    void threeCopiesUnknownKnown100Known128ConflictAllOrdersCheckpairwise() {
        // 与上面重复的显式 all-pairs 语义：3 份副本任何一份为 first 都必须拒绝
        // （LeagueReplays 内部已用 group-level all-pairs，这里验证公共 collect 结果稳定）。
        final List<LeagueTestBattles.PlayerSpec> specsU = LeagueTestBattles.defaultSevenVsSeven();
        specsU.getFirst().dead(0);
        final List<LeagueTestBattles.PlayerSpec> specs100 = LeagueTestBattles.defaultSevenVsSeven();
        specs100.getFirst().dead(100);
        final List<LeagueTestBattles.PlayerSpec> specs128 = LeagueTestBattles.defaultSevenVsSeven();
        specs128.getFirst().dead(128);
        final List<Battle> base = List.of(
                LeagueTestBattles.battle(1, specsU),
                LeagueTestBattles.battle(1, specs100),
                LeagueTestBattles.battle(1, specs128));
        for (final Battle b : base) {
            b.arenaId = "111";
        }
        final LeagueReplays.LeagueCollectResult r = collectBattles(base);
        assertEquals(0, r.battles().size());
        assertEquals(3, r.leagueFailures().size());
    }

    /** 全新 Battle：玩家 1001 死亡时间 UNKNOWN(0)；敌方 2001 于 enemyDeath 阵亡（其余存活 300s）。 */
    private static Battle unknownCopy(final double enemyDeath) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.getFirst().dead(0);
        specs.get(7).dead(enemyDeath);
        final Battle b = LeagueTestBattles.battle(1, specs);
        b.arenaId = "111";
        return b;
    }

    /** 全新 Battle：玩家 1001 死亡时间 KNOWN；敌方 2001 于 enemyDeath 阵亡。 */
    private static Battle knownCopy(final double death, final double enemyDeath) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.getFirst().dead(death);
        specs.get(7).dead(enemyDeath);
        final Battle b = LeagueTestBattles.battle(1, specs);
        b.arenaId = "111";
        return b;
    }

    /** 全新 Battle：玩家 1001 死亡时间为指定值（无敌方死亡，其余全部存活 300s）。 */
    private static Battle copyWithDeath(final double death) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.getFirst().dead(death);
        final Battle b = LeagueTestBattles.battle(1, specs);
        b.arenaId = "111";
        return b;
    }

    @Test
    void knownKnownBeyondToleranceRejectedAsConflict() {
        final List<LeagueTestBattles.PlayerSpec> specsX = LeagueTestBattles.defaultSevenVsSeven();
        specsX.getFirst().dead(100.0);
        final Battle x = LeagueTestBattles.battle(1, specsX);
        x.arenaId = "111";
        final List<LeagueTestBattles.PlayerSpec> specsY = LeagueTestBattles.defaultSevenVsSeven();
        specsY.getFirst().dead(128.0);
        final Battle y = LeagueTestBattles.battle(1, specsY);
        y.arenaId = "111";

        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(x, y));
        assertEquals(2, r.leagueFailures().size());
        assertTrue(r.leagueFailures().stream()
                        .allMatch(f -> f.code().equals(LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA)),
                "两个互相矛盾的 KNOWN 死亡时间 → 全部副本拒绝评分");
        assertTrue(r.battles().isEmpty());
        assertEquals(0, r.leagueBatch().battleResults().size());
    }

    // ---- Survivor INVALID 上传顺序无关（P0）：valid+NaN / valid+Infinity / valid+negative ----

    @Test
    void survivorInvalidConflictsRegardlessOfUploadOrder() {
        // 玩家 1001 两份副本都 survived=true；一份 survivalTimeSec=300（合法），
        // 另一份为 INVALID（NaN/Infinity/-1）。Validator 对全玩家拒绝 INVALID，
        // 因此 group 一致性必须 fail closed——两个上传顺序必须同 outcome：
        // 全部 CONFLICTING_REPLAYS_FOR_ARENA、该 arena 0 场 rated（不许某一顺序进入
        // Validator 而另一个顺序被拒绝）。每个顺序用全新 Battle（canonical 不 mutate 冲突副本）。
        for (final double invalid : new double[]{Double.NaN, Double.POSITIVE_INFINITY, -1}) {
            final LeagueReplays.LeagueCollectResult r1 = collectBattles(List.of(
                    survivorCopy(300), survivorCopy(invalid)));
            final LeagueReplays.LeagueCollectResult r2 = collectBattles(List.of(
                    survivorCopy(invalid), survivorCopy(300)));
            for (final LeagueReplays.LeagueCollectResult r : List.of(r1, r2)) {
                assertEquals(0, r.battles().size(),
                        "invalid=" + invalid + " 必须整场拒绝评分（上传顺序无关）");
                assertEquals(2, r.leagueFailures().size());
                assertTrue(r.leagueFailures().stream().allMatch(
                                f -> f.code().equals(LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA)),
                        "invalid=" + invalid + " 必须是 CONFLICTING_REPLAYS_FOR_ARENA");
                assertEquals(0, r.leagueBatch().battleResults().size(),
                        "invalid=" + invalid + " 该 arena 不得进入 Validator/评分");
            }
        }
    }

    /** 全新 Battle：玩家 1001 存活且 survivalTimeSec 为指定值（其余默认 7v7）。 */
    private static Battle survivorCopy(final double survivalTimeSec) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.getFirst().survived = true;
        specs.getFirst().survivalTimeSec = survivalTimeSec;
        final Battle b = LeagueTestBattles.battle(1, specs);
        b.arenaId = "111";
        return b;
    }

    @Test
    void ratingValidationFailureReportsSuccessProgressNotFailure() {
        final Battle bad = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        bad.arenaId = "111";
        bad.settlementAccountsCoveredByRoster = false;
        final List<String> outcomes = new ArrayList<>();
        final LeagueReplays.LeagueCollectResult r = LeagueReplays.collect(
                List.of(new Source("bad.wotbreplay", new byte[]{1})),
                source -> bad, null, (index, name, o) -> outcomes.add(name + ":" + o));
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueFailures().size());
        assertEquals(List.of("bad.wotbreplay:SUCCESS"), outcomes,
                "Rating-ineligible 但已解析的 replay 必须报 SUCCESS（不得计入解析失败）");
    }

    @Test
    void parseFailureReportedAsFailure() throws Exception {
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                new Source("broken.wotbreplay", new byte[]{1, 2, 3})));
        assertEquals(LeagueRatingMode.STANDARD_REPLAY, r.mode());
        assertEquals(1, r.failures().size());
        assertEquals("broken.wotbreplay", r.failures().getFirst()[0]);
    }
}
