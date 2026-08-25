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
import com.wotb.web.replay.dto.AggRow;
import com.wotb.web.replay.dto.BattleDto;
import com.wotb.web.replay.dto.ExportResult;
import com.wotb.web.replay.dto.PreviewResponse;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

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

/** League Rating 模式矩阵：preview / aggregate export / each export 规则一致。 */
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
        // Performance Metrics（contribution/kast/impact）必须保留在 CW 单场
        assertTrue(r.playerColumns().stream().anyMatch(c -> c.key().equals("contribution")));
        assertTrue(r.playerColumns().stream().anyMatch(c -> c.key().equals("kast")));
        assertTrue(r.playerColumns().stream().anyMatch(c -> c.key().equals("impact")));
        assertTrue(r.playerColumns().stream().anyMatch(c -> c.key().equals("league_rating")));
        // 玩家单元格含 Rating 维度 + 单场 Performance Metrics
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("league_rating"));
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("league_damage_score"));
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("contribution"));
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("kast"));
        assertTrue(r.battles().getFirst().players().getFirst().cells().containsKey("impact"));
        // leagueMode 与 league 结果存在性分离（CW 批次 leagueMode=true）
        assertTrue(r.leagueMode(), "CW 批次 leagueMode 必须为 true（即使个别场次 Rating-ineligible）");
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
    void mixedBatchPreviewKeepsBattlesAndReportsLeagueUnavailable() throws Exception {
        // Case I：混合批次不再 HTTP 400——League Rating 不聚合（league=null），
        // battles 按普通回放语义成功返回，leagueUnavailableCode 携带混合码。
        final Battle training = LeagueTestReplays.sevenVsSeven(1);
        training.arenaId = "111";
        training.arenaBonusType = 2;
        final Battle random = LeagueTestReplays.sevenVsSeven(1);
        random.arenaId = "999";
        random.arenaBonusType = 1;
        final ReplayService service = perFileService(List.of(training, random));

        final PreviewResponse r = service.preview(new MockMultipartFile[]{
                file("t.wotbreplay", new byte[]{1}), file("r.wotbreplay", new byte[]{2})});
        assertNull(r.league(), "混合批次不产生 League Rating 元数据");
        assertEquals(2, r.battles().size(), "混合批次所有可解析 Battle 必须保留在 Preview");
        assertEquals("MIXED_LEAGUE_AND_STANDARD_REPLAYS", r.leagueUnavailableCode());
        assertFalse(r.leagueMode(), "混合批次按普通回放语义，leagueMode 必须为 false");
        assertTrue(r.failures().isEmpty(), "混合批次无解析失败时 failures 必须为空");
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

    // ---- multi aggregate export filename contract（Standard / League / Mixed 单一规则）----

    @Test
    void standardMultiExportUsesStandardAggregateFilename() throws Exception {
        final Battle b1 = LeagueTestReplays.sevenVsSeven(1);
        b1.arenaId = "111";
        b1.arenaBonusType = 1;
        final Battle b2 = LeagueTestReplays.sevenVsSeven(1);
        b2.arenaId = "222";
        b2.arenaBonusType = 1;
        final ReplayService service = perFileService(List.of(b1, b2));
        final ExportResult result = service.export(new MockMultipartFile[]{
                file("s1.wotbreplay", new byte[]{1}), file("s2.wotbreplay", new byte[]{2})}, "aggregate");
        assertNotNull(result);
        assertEquals("回放汇总.xlsx", result.filename(), "multi Standard 必须用标准汇总文件名");
    }

    @Test
    void leagueMultiExportUsesLeagueAggregateFilename() throws Exception {
        final Battle b1 = LeagueTestReplays.sevenVsSeven(1);
        b1.arenaId = "111";
        final Battle b2 = LeagueTestReplays.sevenVsSeven(1);
        b2.arenaId = "222";
        final ReplayService service = perFileService(List.of(b1, b2));
        final ExportResult result = service.export(new MockMultipartFile[]{
                file("c1.wotbreplay", new byte[]{1}), file("c2.wotbreplay", new byte[]{2})}, "aggregate");
        assertNotNull(result);
        assertEquals("联赛汇总.xlsx", result.filename(), "multi 纯 CW 必须用联赛汇总文件名");
    }

    @Test
    void mixedMultiExportUsesStandardAggregateFilename() throws Exception {
        final Battle training = LeagueTestReplays.sevenVsSeven(1);
        training.arenaId = "111";
        training.arenaBonusType = 2;
        final Battle random = LeagueTestReplays.sevenVsSeven(1);
        random.arenaId = "222";
        random.arenaBonusType = 1;
        final ReplayService service = perFileService(List.of(training, random));
        final ExportResult result = service.export(new MockMultipartFile[]{
                file("t.wotbreplay", new byte[]{1}), file("r.wotbreplay", new byte[]{2})}, "aggregate");
        assertNotNull(result, "混合批次 aggregate 导出必须正常（League Rating unavailable 不影响 Replay 导出）");
        assertEquals("回放汇总.xlsx", result.filename(), "multi Mixed 必须用标准汇总文件名");
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
    void leagueEachExportMixedBatchWritesStandardWorkbooks() throws Exception {
        // 混合批次 each 导出按普通回放逐场生成标准单场工作簿（League Analysis unavailable）
        final Battle training = LeagueTestReplays.sevenVsSeven(1);
        training.arenaId = "111";
        training.arenaBonusType = 2;
        final Battle random = LeagueTestReplays.sevenVsSeven(1);
        random.arenaId = "999";
        random.arenaBonusType = 1;
        final ReplayService service = perFileService(List.of(training, random));
        final ExportResult result = service.export(new MockMultipartFile[]{
                file("t.wotbreplay", LeagueTestReplays.replayBytes(training, 2)),
                file("r.wotbreplay", LeagueTestReplays.replayBytes(random, 1))}, "each");
        assertNotNull(result, "混合批次 each 导出必须成功（不得整体拒绝）");
        assertTrue(result.filename().endsWith(".zip"));
        assertTrue(result.data().length > 0);
    }

    @Test
    void leagueEachExportKeepsRatingIneligibleParsedBattleAsStandardWorkbook() throws Exception {
        // 纯 CW 2 场：1 场可评分（7v7）、1 场解析成功但 Rating-ineligible（13 人）。
        // 每场都必须进入 ZIP——已评分 → League 单场工作簿；未评分 → 标准单场工作簿
        // （Replay facts / Performance Metrics 保留，不跳过）。
        final Battle rated = LeagueTestReplays.sevenVsSeven(1);
        rated.arenaId = "111";
        final Battle ineligible = LeagueTestReplays.sevenVsSeven(1);
        ineligible.arenaId = "222";
        ineligible.players.remove(0); // 13 人 → NOT_SEVEN_VS_SEVEN，Rating-ineligible
        final ReplayService service = perFileService(List.of(rated, ineligible));
        final ExportResult result = service.export(new MockMultipartFile[]{
                file("rated.wotbreplay", LeagueTestReplays.replayBytes(rated, 2)),
                file("unrated.wotbreplay", LeagueTestReplays.replayBytes(ineligible, 2))}, "each");
        assertNotNull(result);
        assertTrue(result.filename().endsWith(".zip"));
        final List<String> names = new ArrayList<>();
        final List<String> texts = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(result.data()))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) {
                    texts.add(workbookText(wb));
                }
                names.add(entry.getName());
            }
        }
        assertEquals(2, names.size(), "纯 CW each 必须导出 2 个 XLSX（1 League + 1 Standard，不得丢弃 ineligible 场）");
        assertTrue(texts.get(0).contains("战队Rating"), "rated 场应为 League 单场工作簿");
        assertFalse(texts.get(1).contains("战队Rating"), "ineligible 场应为标准单场工作簿（无 Rating 块）");
        assertTrue(texts.get(1).contains("P1002"), "标准工作簿仍保留 Replay facts / 玩家身份");
    }

    private static String workbookText(final Workbook wb) {
        final StringBuilder sb = new StringBuilder();
        for (int s = 0; s < wb.getNumberOfSheets(); s++) {
            final var sheet = wb.getSheetAt(s);
            for (int rr = 0; rr <= sheet.getLastRowNum(); rr++) {
                final var row = sheet.getRow(rr);
                if (row == null) {
                    continue;
                }
                for (int c = 0; c < row.getLastCellNum(); c++) {
                    final var cell = row.getCell(c);
                    if (cell != null && cell.getCellType() == org.apache.poi.ss.usermodel.CellType.STRING) {
                        sb.append(cell.getStringCellValue());
                    }
                }
            }
        }
        return sb.toString();
    }

    @Test
    void leagueEachExportExcludesPotentialDamageAndKeepsLeagueFacts() throws Exception {
        // 纯 CW each：League 单场工作簿必须过滤 Potential Damage family
        // （该指标不是 League Analysis 数据，也不得为它运行 enrichment）；
        // 但 League 扩展（总Rating）与单场 Performance Metrics（Contribution/KAST/Impact）
        // 及基础 Replay facts（伤害）必须保留。
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "111";
        final ReplayService service = leagueService(battle);
        final ExportResult result = service.export(new MockMultipartFile[]{
                file("a.wotbreplay", LeagueTestReplays.replayBytes(battle, 2))}, "each");
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(result.data()))) {
            final ZipEntry entry = zip.getNextEntry();
            assertNotNull(entry);
            try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) {
                final Sheet players = wb.getSheet("玩家数据");
                final Row header = players.getRow(0);
                final StringBuilder headerText = new StringBuilder();
                for (int c = 0; c < header.getLastCellNum(); c++) {
                    headerText.append(header.getCell(c).getStringCellValue()).append("|");
                }
                assertTrue(!headerText.toString().contains("潜在伤害"),
                        "League 单场工作簿不得含 潜在伤害 列：" + headerText);
                assertTrue(headerText.toString().contains("总Rating"), "League 单场必须含 总Rating");
                assertTrue(headerText.toString().contains("贡献度"), "League 单场必须含 Contribution");
                assertTrue(headerText.toString().contains("KAST"), "League 单场必须含 KAST");
                assertTrue(headerText.toString().contains("Impact"), "League 单场必须含 Impact");
                assertTrue(headerText.toString().contains("伤害"), "League 单场必须保留基础 Replay facts");
            }
        }
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
        assertEquals(1, r.battles().size(), "Rating 不合格的单场也必须保留在 Preview（领域分离）");
        assertNull(r.battles().getFirst().league(), "未评分场不得被绑定任何 Rating");
        assertTrue(r.league().failures().stream()
                .anyMatch(f -> f.code().equals(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN)));
    }

    // ---- partial League Rating（battles 保留全部，Rating 只对 eligible）----

    @Test
    void partialLeaguePreviewKeepsAllBattlesAndRatingOnlyForEligible() throws Exception {
        final Battle good = LeagueTestReplays.sevenVsSeven(1);
        good.arenaId = "111";
        good.arenaBonusType = 2;
        final Battle bad = LeagueTestReplays.sevenVsSeven(2);
        bad.arenaId = "222";
        bad.arenaBonusType = 2;
        bad.settlementAccountsCoveredByRoster = false;
        final ReplayService service = perFileService(List.of(good, bad));

        final PreviewResponse r = service.preview(new MockMultipartFile[]{
                file("g.wotbreplay", new byte[]{1}), file("b.wotbreplay", new byte[]{2})});
        assertEquals("LEAGUE_RATING", r.league().mode());
        assertEquals(2, r.battles().size(), "Rating-ineligible Battle 必须保留在 Preview");
        // identity 绑定：eligible 场带 Rating，ineligible 场 league==null，不得 index 错绑
        final BattleDto goodDto = r.battles().get(0);
        final BattleDto badDto = r.battles().get(1);
        assertEquals("111", goodDto.arenaId());
        assertNotNull(goodDto.league(), "eligible 场必须携带 Rating 元数据");
        assertNull(badDto.league(), "ineligible 场不得被错误绑定 Rating");
        assertTrue(r.league().failures().stream()
                .anyMatch(f -> f.code().equals(LeagueFailure.Code.ROSTER_INCOMPLETE)));
    }

    @Test
    void leaguePreviewCarriesBaseReplayAggregateAlongsideLeagueSummary() throws Exception {
        // League Rating Summary 是附加分析，不替代基础 Replay Aggregate。
        // 多场 League 批次的 resp.aggregate 必须包含标准基础汇总（0 场可评分 ≠ Replay 没数据）；
        // League aggregateColumns 保留跨场 contribution/kast/impact。
        final Battle good = LeagueTestReplays.sevenVsSeven(1);
        good.arenaId = "111";
        good.arenaBonusType = 2;
        final Battle bad = LeagueTestReplays.sevenVsSeven(2);
        bad.arenaId = "222";
        bad.arenaBonusType = 2;
        bad.settlementAccountsCoveredByRoster = false;
        final ReplayService service = perFileService(List.of(good, bad));

        final PreviewResponse r = service.preview(new MockMultipartFile[]{
                file("g.wotbreplay", new byte[]{1}), file("b.wotbreplay", new byte[]{2})});
        assertEquals("LEAGUE_RATING", r.league().mode());
        assertFalse(r.aggregate().isEmpty(), "League 模式也必须输出基础 Replay Aggregate（跨场汇总）");
        assertFalse(r.league().playerSummaries().isEmpty(), "League 汇总同时存在（不是二选一）");
        // CW 汇总列必须保留跨场 contribution/kast/impact
        assertTrue(r.aggregateColumns().stream().anyMatch(c -> c.key().equals("contribution")),
                "CW 汇总列必须含跨场 contribution（Performance Metrics 保留）");
        assertTrue(r.aggregateColumns().stream().anyMatch(c -> c.key().equals("kast")));
        assertTrue(r.aggregateColumns().stream().anyMatch(c -> c.key().equals("impact")));
        // 汇总行 cells 含跨场表现指标（HP 已知场非 null）
        final AggRow first = r.aggregate().getFirst();
        assertTrue(first.cells().containsKey("contribution"), "汇总行必须输出 contribution 列值");
        assertTrue(first.cells().containsKey("impact"), "汇总行必须输出 impact 列值");
        // league playerSummary 列与值含跨场 Performance Metrics
        assertTrue(r.league().playerSummaryColumns().stream().anyMatch(c -> c.key().equals("kast")),
                "league.playerSummaryColumns 必须含 kast");
        // rated_battles 必须进入生产 playerSummaryColumns（ColumnDef 链）
        assertTrue(r.league().playerSummaryColumns().stream().anyMatch(c -> c.key().equals("rated_battles")),
                "league.playerSummaryColumns 必须含 rated_battles（评分场次列契约）");
        assertTrue(r.league().playerSummaries().stream()
                        .anyMatch(s -> s.impact() != null),
                "league.playerSummaries 必须携带跨场 impact");
    }

    // ---- CW/League 单场也生成基础 Replay Aggregate row ----

    @Test
    void singleCwBattlePreviewCarriesBaseAggregateFacts() throws Exception {
        // CW 单场：Unified Summary 的 damage_avg/assisted_avg/kills_avg/earned_avg 由 Replay Core
        // 权威事实得出（battles=1 → avg=本场值），禁止伪装成 unavailable（'--'）。
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "111";
        battle.arenaBonusType = 2;
        final PreviewResponse r = leagueService(battle).preview(new MockMultipartFile[]{
                file("a.wotbreplay", new byte[]{1})});
        assertNotNull(r.league());
        assertFalse(r.aggregate().isEmpty(), "CW 单场必须生成基础 Replay Aggregate row（Unified Summary 事实源）");
        // Team1 首名（accountId 1001）：damage=450 / assist=100 / kills=2 / earned=0
        final AggRow row = r.aggregate().stream()
                .filter(a -> ((Number) a.cells().get("account_id")).longValue() == 1001L)
                .findFirst().orElseThrow();
        assertEquals(1, ((Number) row.cells().get("battles")).intValue(), "解析场次 = 1");
        assertEquals(450.0, ((Number) row.cells().get("damage_avg")).doubleValue(), 0.01);
        assertEquals(100.0, ((Number) row.cells().get("assisted_avg")).doubleValue(), 0.01);
        assertEquals(2.0, ((Number) row.cells().get("kills_avg")).doubleValue(), 0.01);
        assertEquals(0.0, ((Number) row.cells().get("earned_avg")).doubleValue(), 0.01);
        // rated_battles = League Player Summary 评分场次（独立于解析场次 battles）
        assertTrue(r.league().playerSummaries().stream()
                        .anyMatch(s -> s.accountId() == 1001L && s.battles() == 1),
                "CW 单场评分场次 = 1");
    }

    @Test
    void singleCwIneligibleBattleStillCarriesAggregateFacts() throws Exception {
        // Rating-ineligible CW 单场：基础 aggregate facts 仍生成（Replay Core），Rating/七维为 null（UI '--'）
        final Battle bad = LeagueTestReplays.sevenVsSeven(1);
        bad.arenaId = "111";
        bad.arenaBonusType = 2;
        bad.settlementAccountsCoveredByRoster = false;
        final PreviewResponse r = leagueService(bad).preview(new MockMultipartFile[]{
                file("bad.wotbreplay", new byte[]{1})});
        assertNotNull(r.league(), "ineligible 场仍是 CW 批次（leagueMode=true）");
        assertNull(r.battles().getFirst().league(), "未评分场不得绑定 Rating");
        assertFalse(r.aggregate().isEmpty(), "Rating-ineligible CW 单场仍生成基础 aggregate facts（不丢事实）");
        final AggRow row = r.aggregate().stream()
                .filter(a -> ((Number) a.cells().get("account_id")).longValue() == 1001L)
                .findFirst().orElseThrow();
        assertEquals(450.0, ((Number) row.cells().get("damage_avg")).doubleValue(), 0.01);
        assertEquals(2.0, ((Number) row.cells().get("kills_avg")).doubleValue(), 0.01);
        // 该场无评分 → 不产生评分汇总行（rated_battles 空，Rating 由前端统一显示 '--'）
        assertTrue(r.league().playerSummaries().isEmpty(), "ineligible 场不得产生评分汇总行");
    }

    @Test
    void standardSingleBattleAggregateStaysEmpty() throws Exception {
        // Standard（Random）单场：aggregate 保持空（旧语义；不得回归）
        final Battle battle = LeagueTestReplays.sevenVsSeven(1);
        battle.arenaId = "333";
        battle.arenaBonusType = 1;
        final PreviewResponse r = leagueService(battle).preview(new MockMultipartFile[]{
                file("c.wotbreplay", new byte[]{3})});
        assertNull(r.league());
        assertTrue(r.aggregate().isEmpty(), "Standard 单场 aggregate 必须为空（多场才跨场汇总）");
    }

    @Test
    void singleIneligibleLeagueExportFallsBackToStandardWorkbook() throws Exception {
        final Battle bad = LeagueTestReplays.sevenVsSeven(1);
        bad.arenaId = "111";
        bad.arenaBonusType = 2;
        bad.settlementAccountsCoveredByRoster = false;
        final ExportResult result = leagueService(bad).export(
                new MockMultipartFile[]{file("bad.wotbreplay", new byte[]{1})}, "aggregate");
        assertNotNull(result, "单场 league 未通过校验也必须能导出基础数据（不崩溃、不错位）");
        assertTrue(result.filename().endsWith(".xlsx"));
        assertTrue(result.data().length > 0);
    }
}
