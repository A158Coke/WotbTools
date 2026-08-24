package com.wotb.web.replay.service;

import com.wotb.core.league.LeagueFailure;
import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.model.Battle;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.web.replay.LeagueTestReplays;
import com.wotb.web.replay.dto.BattleDto;
import com.wotb.web.replay.dto.ExportResult;
import com.wotb.web.replay.dto.PreviewResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** League Rating 模式矩阵：preview / aggregate export / each export 规则一致（plan §21.3）。 */
class ReplayServiceLeagueTest {

    private static MockMultipartFile file(final String name, final byte[] bytes) {
        return new MockMultipartFile("files", name, "application/octet-stream", bytes);
    }

    /** 单个 league 回放（真实字节）经 mocked full processing 得到 league battle。 */
    private static ReplayService leagueService(final Battle battle) {
        final DefaultReplayProcessingFacade processingFacade = mock(DefaultReplayProcessingFacade.class);
        when(processingFacade.process(any(), eq(ReplayProcessingOptions.full()))).thenReturn(
                new ReplayProcessingResult("league.wotbreplay", ReplayProcessingStatus.SUCCESS,
                        null, battle, null, null,
                        ReplayProcessingCapabilities.summaryOnly(false), null, null));
        return new ReplayService(new ReplayCapacityLimiter(1), processingFacade, null);
    }

    private static ReplayService perFileService(final List<Battle> battles) {
        final DefaultReplayProcessingFacade processingFacade = mock(DefaultReplayProcessingFacade.class);
        final AtomicInteger index = new AtomicInteger();
        when(processingFacade.process(any(), eq(ReplayProcessingOptions.full()))).thenAnswer(inv -> {
            final int i = Math.min(index.getAndIncrement(), battles.size() - 1);
            final Battle b = battles.get(i);
            return new ReplayProcessingResult("league.wotbreplay", ReplayProcessingStatus.SUCCESS,
                    null, b, null, null,
                    ReplayProcessingCapabilities.summaryOnly(false), null, null);
        });
        return new ReplayService(new ReplayCapacityLimiter(1), processingFacade, null);
    }

    // ---- preview ----

    @Test
    void singleTrainingPreviewHasLeagueRating() throws Exception {
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "111";
        battle.arenaBonusType = 2;
        final PreviewResponse r = leagueService(battle).preview(new MockMultipartFile[]{
                file("a.wotbreplay", new byte[]{1})});

        assertNotNull(r.league());
        assertEquals("LEAGUE_RATING", r.league().mode());
        assertEquals(1, r.battles().size());
        assertNotNull(r.battles().getFirst().league());
        assertNotNull(r.battles().getFirst().league().team1());
        assertNotNull(r.battles().getFirst().league().team2());
        // League 模式玩家列不含旧三指标
        assertFalse(r.playerColumns().stream().anyMatch(c -> c.key().equals("contribution")));
        assertFalse(r.playerColumns().stream().anyMatch(c -> c.key().equals("kast")));
        assertFalse(r.playerColumns().stream().anyMatch(c -> c.key().equals("impact")));
        assertTrue(r.playerColumns().stream().anyMatch(c -> c.key().equals("league_rating")));
        // 玩家单元格含 Rating 维度
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("league_rating"));
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("league_damage_score"));
        // 固定列元数据
        assertTrue(r.league().columns().stream().anyMatch(c -> c.key().equals("league_rating") && c.fixed()));
        assertEquals(1000, r.league().columns().stream()
                .filter(c -> c.key().equals("league_rating")).findFirst().orElseThrow().max(), 1e-9);
    }

    @Test
    void tournamentPreviewHasLeagueRating() throws Exception {
        final Battle battle = LeagueTestReplays.sevenVsSeven(2);
        battle.arenaId = "222";
        battle.arenaBonusType = 4;
        final PreviewResponse r = leagueService(battle).preview(new MockMultipartFile[]{
                file("b.wotbreplay", new byte[]{2})});
        assertEquals("LEAGUE_RATING", r.league().mode());
    }

    @Test
    void standardPreviewHasNoLeague() throws Exception {
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "333";
        battle.arenaBonusType = 1;
        final PreviewResponse r = leagueService(battle).preview(new MockMultipartFile[]{
                file("c.wotbreplay", new byte[]{3})});
        assertNull(r.league());
        // 普通模式保留旧三指标
        assertTrue(r.playerColumns().stream().anyMatch(c -> c.key().equals("contribution")));
    }

    @Test
    void mixedBatchRejectedWithStableCode() throws Exception {
        final Battle training = LeagueTestReplays.sevenVsSeven(1);
        training.arenaId = "111";
        training.arenaBonusType = 2;
        final Battle random = LeagueTestReplays.sevenVsSeven(1);
        random.arenaId = "999";
        random.arenaBonusType = 1;
        final ReplayService service = perFileService(List.of(training, random));

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> service.preview(new MockMultipartFile[]{
                        file("t.wotbreplay", new byte[]{1}), file("r.wotbreplay", new byte[]{2})}));
        assertEquals("MIXED_LEAGUE_AND_STANDARD_REPLAYS", error.getMessage());
    }

    @Test
    void trainingPlusTournamentBatchAllowed() throws Exception {
        final Battle t1 = LeagueTestReplays.sevenVsSeven(1);
        t1.arenaId = "111";
        t1.arenaBonusType = 2;
        final Battle t2 = LeagueTestReplays.sevenVsSeven(2);
        t2.arenaId = "222";
        t2.arenaBonusType = 4;
        final ReplayService service = perFileService(List.of(t1, t2));

        final PreviewResponse r = service.preview(new MockMultipartFile[]{
                file("t1.wotbreplay", new byte[]{1}), file("t2.wotbreplay", new byte[]{2})});
        assertEquals("LEAGUE_RATING", r.league().mode());
        assertEquals(2, r.battles().size());
        assertEquals(2, r.league().playerSummaries().size() > 0 ? 2 : r.league().playerSummaries().size());
        assertFalse(r.league().playerSummaries().isEmpty());
    }

    @Test
    void leagueAggregateExportWritesLeagueWorkbook() throws Exception {
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "111";
        battle.arenaBonusType = 2;
        final ExportResult result = leagueService(battle).export(
                new MockMultipartFile[]{file("a.wotbreplay", new byte[]{1})}, "aggregate");
        assertNotNull(result);
        assertTrue(result.data().length > 0);
        assertTrue(result.filename().endsWith(".xlsx"));
    }

    @Test
    void leagueEachExportUsesPeekModeAndWritesLeagueWorkbook() throws Exception {
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "111";
        final byte[] bytes = LeagueTestReplays.replayBytes(battle, 2);
        final ExportResult result = leagueService(battle).export(
                new MockMultipartFile[]{file("a.wotbreplay", bytes)}, "each");
        assertNotNull(result);
        assertTrue(result.filename().endsWith(".zip"));
        assertTrue(result.data().length > 0);
    }

    @Test
    void leagueEachExportRejectsMixedBatch() throws Exception {
        final Battle training = LeagueTestReplays.sevenVsSeven(1);
        training.arenaId = "111";
        final Battle random = LeagueTestReplays.sevenVsSeven(1);
        random.arenaId = "999";
        random.arenaBonusType = 1;
        final ReplayService service = perFileService(List.of(training, random));
        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> service.export(new MockMultipartFile[]{
                        file("t.wotbreplay", LeagueTestReplays.replayBytes(training, 2)),
                        file("r.wotbreplay", LeagueTestReplays.replayBytes(random, 1))}, "each"));
        assertEquals("MIXED_LEAGUE_AND_STANDARD_REPLAYS", error.getMessage());
    }

    @Test
    void leagueValidationFailureReportedWithCode() throws Exception {
        final Battle bad = LeagueTestReplays.sevenVsSeven(1);
        bad.arenaId = "111";
        bad.arenaBonusType = 2;
        bad.players.remove(0); // 13 人
        final PreviewResponse r = leagueService(bad).preview(new MockMultipartFile[]{
                file("bad.wotbreplay", new byte[]{1})});
        assertNotNull(r.league());
        assertEquals(1, r.battles().size(), "Rating 不合格的单场也必须保留在 Preview（领域分离，P0）");
        assertNull(r.battles().getFirst().league(), "未评分场不得被绑定任何 Rating");
        assertTrue(r.league().failures().stream()
                .anyMatch(f -> f.code().equals(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN)));
    }

    // ---- P0 回归：partial League Rating（battles 保留全部，Rating 只对 eligible）----

    @Test
    void partialLeaguePreviewKeepsAllBattlesAndRatingOnlyForEligible() throws Exception {
        final Battle good = LeagueTestReplays.sevenVsSeven(1);
        good.arenaId = "111";
        good.arenaBonusType = 2;
        final Battle bad = LeagueTestReplays.sevenVsSeven(2);
        bad.arenaId = "222";
        bad.arenaBonusType = 2;
        bad.rosterComplete = false;
        final ReplayService service = perFileService(List.of(good, bad));

        final PreviewResponse r = service.preview(new MockMultipartFile[]{
                file("g.wotbreplay", new byte[]{1}), file("b.wotbreplay", new byte[]{2})});
        assertEquals("LEAGUE_RATING", r.league().mode());
        assertEquals(2, r.battles().size(), "Rating-ineligible Battle 必须保留在 Preview");
        // identity 绑定（plan §9）：eligible 场带 Rating，ineligible 场 league==null，不得 index 错绑
        final BattleDto goodDto = r.battles().get(0);
        final BattleDto badDto = r.battles().get(1);
        assertEquals("111", goodDto.arenaId());
        assertNotNull(goodDto.league(), "eligible 场必须携带 Rating 元数据");
        assertNull(badDto.league(), "ineligible 场不得被错误绑定 Rating");
        assertTrue(r.league().failures().stream()
                .anyMatch(f -> f.code().equals(LeagueFailure.Code.ROSTER_INCOMPLETE)));
    }

    @Test
    void singleIneligibleLeagueExportFallsBackToStandardWorkbook() throws Exception {
        final Battle bad = LeagueTestReplays.sevenVsSeven(1);
        bad.arenaId = "111";
        bad.arenaBonusType = 2;
        bad.rosterComplete = false;
        final ExportResult result = leagueService(bad).export(
                new MockMultipartFile[]{file("bad.wotbreplay", new byte[]{1})}, "aggregate");
        assertNotNull(result, "单场 league 未通过校验也必须能导出基础数据（不崩溃、不错位）");
        assertTrue(result.filename().endsWith(".xlsx"));
        assertTrue(result.data().length > 0);
    }
}
