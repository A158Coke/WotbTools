package com.wotb.core.league;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.ref.Tankopedia;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** League Rating Excel 导出（plan §18/§21.6）：不含旧三指标、含维度分/满分/百分比、战队名称覆盖。 */
class LeagueExcelExportTest {

    private static LeagueRatingResult ratedBattle(final int winner) {
        final Battle battle = LeagueTestBattles.battle(winner, LeagueTestBattles.defaultSevenVsSeven());
        return LeagueRatingCalculator.calculate(battle);
    }

    @Test
    void singleLeagueWorkbookContainsRatingColumnsAndNoLegacyMetrics() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingleLeague(battle, result, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            assertEquals(3, wb.getNumberOfSheets());
            assertEquals("玩家数据", wb.getSheetName(0));
            assertEquals("战斗信息", wb.getSheetName(1));
            assertEquals("原始字段", wb.getSheetName(2));

            final Sheet players = wb.getSheet("玩家数据");
            final Row header = players.getRow(0);
            final StringBuilder headerText = new StringBuilder();
            for (int c = 0; c < header.getLastCellNum(); c++) {
                headerText.append(header.getCell(c).getStringCellValue()).append("|");
            }
            assertTrue(headerText.toString().contains("总Rating"), "必须包含总Rating列");
            assertTrue(headerText.toString().contains("伤害评分"), "必须包含维度列");
            assertTrue(headerText.toString().contains("占点得分"), "必须包含占点原始字段");
            assertTrue(headerText.toString().contains("占领分"), "必须包含占领分原始字段");
            assertTrue(!headerText.toString().contains("贡献度"), "League 模式不得含 Contribution");
            assertTrue(!headerText.toString().contains("KAST"), "League 模式不得含 KAST");
            assertTrue(!headerText.toString().contains("Impact"), "League 模式不得含 Impact");

            // 战队 Rating + MVP 在战斗信息表
            final Sheet info = wb.getSheet("战斗信息");
            final StringBuilder infoText = new StringBuilder();
            for (int r = 0; r <= info.getLastRowNum(); r++) {
                final Row row = info.getRow(r);
                if (row == null) {
                    continue;
                }
                for (int c = 0; c < row.getLastCellNum(); c++) {
                    infoText.append(row.getCell(c)).append("|");
                }
            }
            assertTrue(infoText.toString().contains("战队Rating"), "战斗信息必须含战队 Rating");
            assertTrue(infoText.toString().contains("MVP"), "战斗信息必须含全场 MVP");
        }
    }

    @Test
    void singleLeagueWorkbookAppliesTeamNameOverrides() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingleLeague(battle, result, Tankopedia.load(),
                Map.of(battle.arenaId + ":1", "我的战队"), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Sheet info = wb.getSheet("战斗信息");
            final StringBuilder infoText = new StringBuilder();
            for (int r = 0; r <= info.getLastRowNum(); r++) {
                final Row row = info.getRow(r);
                if (row == null) {
                    continue;
                }
                for (int c = 0; c < row.getLastCellNum(); c++) {
                    infoText.append(row.getCell(c)).append("|");
                }
            }
            assertTrue(infoText.toString().contains("我的战队"), "用户覆盖的战队名称必须进入 Excel");
        }
    }

    @Test
    void aggregateLeagueWorkbookHasAllSheets() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(battle), List.of(result), List.of());
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(battle), List.of("one.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            assertEquals(4, wb.getNumberOfSheets());
            assertEquals("选手汇总", wb.getSheetName(0));
            assertEquals("战队汇总", wb.getSheetName(1));
            assertEquals("每场明细", wb.getSheetName(2));
            assertEquals("战斗列表", wb.getSheetName(3));
            assertNotNull(wb.getSheet("选手汇总").getRow(1), "选手汇总应有数据行");
            assertNotNull(wb.getSheet("战队汇总").getRow(1), "战队汇总应有数据行");
        }
    }

    @Test
    void aggregateLeagueWorkbookAppliesTeamKeyOverride() throws Exception {
        // 两场 team1 均 clan=AAA → 批次 teamKey = clan:AAA（PR #123 Blocker 2：批次 identity override）
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(b1);
        final LeagueRatingResult r2 = LeagueRatingCalculator.calculate(b2);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(b1, b2), List.of(r1, r2), List.of());
        assertTrue(batch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("clan:AAA")));

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), batch, Tankopedia.load(), Map.of(), Map.of("clan:AAA", "CHRD A队"), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Sheet sheet = wb.getSheet("战队汇总");
            assertNotNull(sheet);
            final StringBuilder text = new StringBuilder();
            for (int rr = 0; rr <= sheet.getLastRowNum(); rr++) {
                final var row = sheet.getRow(rr);
                if (row == null) continue;
                for (int c = 0; c < row.getLastCellNum(); c++) {
                    text.append(row.getCell(c));
                }
            }
            assertTrue(text.toString().contains("CHRD A队"),
                    "批次 teamKey override 必须进入 aggregate Excel 战队汇总，实际：" + text);
        }
    }


    /** 两场 7v7 数据集（team1 clan=AAA → teamKey clan:AAA，team2 clan=BBB）。 */
    private static LeagueRatingBatch twoBattleBatch(final LeagueRatingResult r1, final LeagueRatingResult r2,
                                                    final Battle b1, final Battle b2) {
        return LeagueRatingBatchAggregator.aggregate(List.of(b1, b2), List.of(r1, r2), List.of());
    }

    /** 收集 sheet 全部单元格字符串（含数值）。 */
    private static String sheetTextAll(final Sheet sheet) {
        final StringBuilder sb = new StringBuilder();
        for (int rr = 0; rr <= sheet.getLastRowNum(); rr++) {
            final var row = sheet.getRow(rr);
            if (row == null) continue;
            for (int c = 0; c < row.getLastCellNum(); c++) {
                sb.append(row.getCell(c));
            }
        }
        return sb.toString();
    }


    @Test
    void aggregateDetailSheetAppliesBattleTeamOverrides() throws Exception {
        // PR #123 Blocker 1（Test 1）：battle override 必须进入「每场明细」，不得仍是 Team 1/Team 2
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(b1);
        final LeagueRatingResult r2 = LeagueRatingCalculator.calculate(b2);
        final LeagueRatingBatch batch = twoBattleBatch(r1, r2, b1, b2);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), batch, Tankopedia.load(),
                Map.of("arena-1:1", "CHRD A", "arena-1:2", "KSR"),
                Map.of(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Sheet detail = wb.getSheet("每场明细");
            assertNotNull(detail);
            final String text = sheetTextAll(detail);
            assertTrue(text.contains("CHRD A"), "每场明细必须用 battle override，实际：" + text);
            assertTrue(text.contains("KSR"), "每场明细必须用 battle override，实际：" + text);
        }
    }

    @Test
    void aggregateDetailBattleOverrideDoesNotChangeTeamSummaryIdentity() throws Exception {
        // PR #123 Blocker 1（Test 2）：battle override 只改单场明细；战队汇总仍走 autoName（AAA）
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(b1);
        final LeagueRatingBatch batch = twoBattleBatch(r1, r1, b1, b1);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(b1, b1), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), batch, Tankopedia.load(),
                Map.of("arena-1:1", "临时阵容名"),
                Map.of(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final String detailText = sheetTextAll(wb.getSheet("每场明细"));
            assertTrue(detailText.contains("临时阵容名"), "每场明细应显示 battle override");
            final String teamText = sheetTextAll(wb.getSheet("战队汇总"));
            assertTrue(teamText.contains("AAA"), "战队汇总必须保持 autoName，不得被 battle override 污染，实际：" + teamText);
            assertTrue(!teamText.contains("临时阵容名"), "战队汇总不得显示单场 override");
        }
    }

    @Test
    void aggregateSummaryOverrideDoesNotLeakIntoDetailSheet() throws Exception {
        // PR #123 Blocker 1（Test 3）：summary override 只改战队汇总；每场明细仍用 autoName（AAA）
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(b1);
        final LeagueRatingBatch batch = twoBattleBatch(r1, r1, b1, b1);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(b1, b1), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), batch, Tankopedia.load(),
                Map.of(), Map.of("clan:AAA", "AAA 一队"), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final String teamText = sheetTextAll(wb.getSheet("战队汇总"));
            assertTrue(teamText.contains("AAA 一队"), "战队汇总应显示 summary override");
            final String detailText = sheetTextAll(wb.getSheet("每场明细"));
            assertTrue(detailText.contains("AAA"), "每场明细应使用该场 autoName");
            assertTrue(!detailText.contains("AAA 一队"), "summary override 不得反向写入每场明细");
        }
    }

}