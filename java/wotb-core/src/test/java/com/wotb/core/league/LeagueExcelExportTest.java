package com.wotb.core.league;

import com.wotb.core.AggregateColumns;
import com.wotb.core.Columns;
import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** League Rating Excel 导出（含单场
 * Performance Metrics contribution/kast/impact、维度分/满分/百分比、战队名称覆盖）。 */
class LeagueExcelExportTest {

    private static LeagueRatingResult ratedBattle(final int winner) {
        final Battle battle = LeagueTestBattles.battle(winner, LeagueTestBattles.defaultSevenVsSeven());
        return LeagueRatingCalculator.calculate(battle);
    }

    @Test
    void singleLeagueWorkbookContainsRatingColumnsAndPerformanceMetrics() throws Exception {
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
            // 单场 Performance Metrics 保留在 CW 单场工作簿
            assertTrue(headerText.toString().contains("贡献度"), "League 单场必须含 Contribution");
            assertTrue(headerText.toString().contains("KAST"), "League 单场必须含 KAST");
            assertTrue(headerText.toString().contains("Impact"), "League 单场必须含 Impact");

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
            // 完整 Replay 汇总（Replay 前缀，全部解析场次）+ League Rating 专属表
            assertEquals(7, wb.getNumberOfSheets());
            assertEquals("Replay 汇总", wb.getSheetName(0));
            assertEquals("Replay 明细", wb.getSheetName(1));
            assertEquals("Replay 战斗列表", wb.getSheetName(2));
            assertEquals("选手汇总", wb.getSheetName(3));
            assertEquals("战队汇总", wb.getSheetName(4));
            assertEquals("每场明细", wb.getSheetName(5));
            assertEquals("战斗列表", wb.getSheetName(6));
            assertNotNull(wb.getSheet("选手汇总").getRow(1), "选手汇总应有数据行");
            assertNotNull(wb.getSheet("战队汇总").getRow(1), "战队汇总应有数据行");
            assertNotNull(wb.getSheet("Replay 汇总").getRow(1), "Replay 汇总应有数据行");
        }
    }

    @Test
    void singleLeagueWorkbookContainsFullCanonicalPlayerSchema() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingleLeague(battle, result, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Row header = wb.getSheet("玩家数据").getRow(0);
            final List<String> headers = new ArrayList<>();
            for (int c = 0; c < header.getLastCellNum(); c++) {
                headers.add(header.getCell(c).getStringCellValue());
            }
            // canonical Columns.PLAYER 全部字段（单一 schema 源；Potential Damage 已从
            // canonical schema 全局移除，因此天然不存在潜在伤害列）
            for (final Columns.Column col : Columns.PLAYER) {
                assertTrue(headers.contains(col.title()),
                        "League 单场玩家数据必须含 canonical 字段：" + col.title() + "，实际表头：" + headers);
            }
            assertTrue(headers.stream().noneMatch(h -> h.contains("潜在伤害") || h.contains("补增伤害")
                            || h.contains("潜在明细")),
                    "Potential Damage 已全局移除，任何表头都不得出现：" + headers);
            // League 专属扩展
            assertTrue(headers.contains("占点得分"), "必须含 占点得分");
            assertTrue(headers.contains("占领分"), "必须含 占领分");
            assertTrue(headers.contains("伤害评分"), "必须含七维评分列");
            assertTrue(headers.contains("总Rating"), "必须含总Rating");
            // 非 Potential 的 canonical Replay facts 必须完整保留（不得误删其它字段）
            for (final String missing : List.of("等级", "坦克类型",
                    "国家", "炮伤", "被命中", "被击穿", "击伤", "排", "军阶", "车辆ID", "账号ID")) {
                assertTrue(headers.contains(missing), "此前缺失字段必须存在：" + missing);
            }
        }
    }

    @Test
    void aggregateLeagueWorkbookContainsFullReplayFactsAndSeparatesRatedSample() throws Exception {
        // 1 rated（arena-1）+ 1 Rating-ineligible（arena-2，同 14 名玩家）：
        // Replay 汇总 battles=2（全部解析场次样本）；League 选手汇总 rated_battles=1（仅 eligible 样本）
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        b2.settlementAccountsCoveredByRoster = false;
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(b1);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(b1), List.of(r1),
                List.of(new LeagueFailure("two.wotbreplay", "arena-2", LeagueFailure.Code.ROSTER_INCOMPLETE)));

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            // Replay 汇总：canonical aggregate facts（含此前缺失的获取点数 + Performance Metrics）
            final Sheet replay = wb.getSheet("Replay 汇总");
            final String replayHeader = headerText(replay);
            for (final String col : List.of("场次", "获取点数总计", "获取点数/场", "贡献度%", "KAST%", "Impact%",
                    "总伤害", "总射击次数", "总命中次数", "总击穿次数")) {
                assertTrue(replayHeader.contains(col), "Replay 汇总必须含 " + col + "，实际：" + replayHeader);
            }
            assertTrue(!replayHeader.contains("潜在伤害"),
                    "Potential Damage 已全局移除，Replay 汇总也不得含潜在伤害：" + replayHeader);
            // 场次列（第 3 列）数据 = 2：全部解析场次样本（含 Rating-ineligible）
            assertEquals(2.0, replay.getRow(1).getCell(2).getNumericCellValue(), 1e-9,
                    "Replay aggregate 样本 = 全部解析场次（2），Rating-ineligible 不得从 aggregate 消失");
            // Replay 明细：覆盖全部 2 场玩家（28 行数据行；ineligible 场 Replay facts 不丢）
            final Sheet replayDetail = wb.getSheet("Replay 明细");
            assertTrue(replayDetail.getLastRowNum() >= 28,
                    "Replay 明细必须覆盖全部解析场次（28 行玩家），实际 " + replayDetail.getLastRowNum());
            // League 选手汇总：rated 样本 battles=1（battles != rated_battles）
            final Sheet leaguePlayers = wb.getSheet("选手汇总");
            assertEquals(1.0, leaguePlayers.getRow(1).getCell(2).getNumericCellValue(), 1e-9,
                    "League rated 样本 = 1（仅 eligible 场次），与实际 battles=2 分离");
            // 战斗列表（League）仍列出 ineligible 场状态
            final String list = sheetTextAll(wb.getSheet("战斗列表"));
            assertTrue(list.contains("arena-2"), "战斗列表必须列出全部解析 battle（含 ineligible）");
            assertTrue(list.contains("名册不完整"), "ineligible 场状态必须显示真实 failure 文案");
        }
    }

    /** League Excel 七维标题测试 oracle（key → 中文标题；验证 canonical DIM_KEYS 全量覆盖，非 positional list）。 */
    private static String dimensionTitleOracle(final String key) {
        return switch (key) {
            case "league_damage_score" -> "伤害评分";
            case "league_assist_score" -> "助攻评分";
            case "league_kill_score" -> "击杀评分";
            case "league_exchange_score" -> "换血效率评分";
            case "league_blocked_score" -> "阻挡评分";
            case "league_survival_score" -> "存活/互换评分";
            case "league_shooting_score" -> "射击效率评分";
            default -> throw new AssertionError("unexpected League dimension key: " + key);
        };
    }

    /** 给一场 battle 的玩家设置 {@code count} 个不同的 platoonId（按 players 顺序循环）。 */
    private static void setDistinctPlatoons(final Battle battle, final int count) {
        int i = 0;
        for (final PlayerResult p : battle.players) {
            p.platoonId = 100L + (i % count);
            i++;
        }
    }

    private static String cellText(final Row row, final int c) {
        final Cell cell = row.getCell(c);
        return cell == null ? "" : cell.getStringCellValue();
    }

    /** Excel 汇总标题（测试 oracle：验证 Excel 汇总列集合与 canonical 列宇宙 exact 对齐）。 */
    private static String summaryTitle(final String key) {
        return switch (key) {
            case "nickname" -> "玩家";
            case "clan" -> "战队";
            case "battles" -> "场次";
            case "wins" -> "胜场";
            case "win_rate" -> "胜率%";
            case "survival_rate" -> "存活率%";
            case "survival_avg" -> "平均存活时间";
            case "kills" -> "总击杀";
            case "kills_avg" -> "场均击杀";
            case "damage" -> "总伤害";
            case "damage_avg" -> "场均伤害";
            case "assisted" -> "总协助伤害";
            case "assisted_avg" -> "场均协助伤害";
            case "received_avg" -> "场均损失血量";
            case "blocked_avg" -> "场均格挡";
            case "hit_rate" -> "命中率%";
            case "pen_rate" -> "击穿率%";
            case "shots" -> "总射击次数";
            case "hits" -> "总命中次数";
            case "pens" -> "总击穿次数";
            case "enemies_damaged_avg" -> "场均击伤";
            case "tanks" -> "用车";
            case "account_id" -> "账号ID";
            case "earned_total" -> "获取点数总计";
            case "earned_avg" -> "获取点数/场";
            case "contribution" -> "贡献度%";
            case "kast" -> "KAST%";
            case "impact" -> "Impact%";
            case "multi_damage_rate" -> "多伤率%";
            case "traded_deaths" -> "互换击杀";
            default -> throw new AssertionError("unexpected aggregate key: " + key);
        };
    }

    private static String headerText(final Sheet sheet) {
        final StringBuilder sb = new StringBuilder();
        final Row header = sheet.getRow(0);
        for (int c = 0; c < header.getLastCellNum(); c++) {
            sb.append(header.getCell(c).getStringCellValue()).append("|");
        }
        return sb.toString();
    }

    // ---- canonical base battle info / raw / aggregate detail schema（XLSX complete-data）----

    @Test
    void standardAndLeagueSingleShareCanonicalBattleInfoAndLeagueHasRecorderVehicle() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.recorder = "P1001";
        battle.recorderVehicle = "Kranvagn";
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);

        final List<String> standardKeys = battleInfoKeys(writeSingle(battle));
        final List<String> leagueKeys = battleInfoKeys(writeSingleLeague(battle, result));

        // canonical base 完全一致（League 不得复制 base list）
        final List<String> base = List.of("游戏版本", "地图", "开始时间", "战斗时长", "获胜队伍",
                "录像者", "录像者车辆", "玩家数", "竞技场ID");
        assertEquals(base, standardKeys, "Standard 单场战斗信息必须恰好是 canonical base");
        for (final String key : base) {
            assertTrue(leagueKeys.contains(key), "League 单场必须含同一 canonical base key：" + key);
        }
        // League 只追加扩展；Rated CW XLSX 不得比 Standard 少基础信息（录像者车辆此前缺失）
        assertEquals(List.of("游戏版本", "地图", "开始时间", "战斗时长", "获胜队伍",
                        "录像者", "录像者车辆", "玩家数", "竞技场ID",
                        "Team 1 战队Rating", "Team 2 战队Rating", "全场MVP",
                        "Team 1 队内最佳", "Team 2 队内最佳"),
                leagueKeys, "League 单场战斗信息 = canonical base + League 扩展");
    }

    @Test
    void rawSheetSchemaIdenticalForStandardAndLeague() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final java.util.Map<Integer, List<Object>> raw = new java.util.HashMap<>();
        raw.put(1, List.of("alpha"));
        raw.put(2, List.of(7L, 8L));
        raw.put(3, List.of(new byte[]{0x01, 0x7F}));
        battle.players.getFirst().raw = raw;
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);

        final List<String> standardHeaders = rawHeaders(writeSingle(battle));
        final List<String> leagueHeaders = rawHeaders(writeSingleLeague(battle, result));
        assertEquals(standardHeaders, leagueHeaders,
                "Standard / League 原始字段表 schema 必须一致（共用 SingleBattleSheets.writeRaw）");
        assertTrue(standardHeaders.contains("#1") && standardHeaders.contains("#2")
                        && standardHeaders.contains("#3"),
                "原始字段表必须含 protobuf 字段号列，实际：" + standardHeaders);
    }

    @Test
    void standardSingleWorkbookNeverExposesPotentialDamageColumns() throws Exception {
        // Potential Damage 已全局移除：Standard 单场 XLSX 玩家数据表不得含 潜在伤害 /
        // 补增伤害 / 潜在明细，基础 Replay facts 必须保留。
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final Workbook wb = writeSingle(battle);
        final Row header = wb.getSheet("玩家数据").getRow(0);
        final List<String> headers = new ArrayList<>();
        for (int c = 0; c < header.getLastCellNum(); c++) {
            headers.add(header.getCell(c).getStringCellValue());
        }
        assertTrue(headers.stream().noneMatch(h -> h.contains("潜在伤害") || h.contains("补增伤害")
                        || h.contains("潜在明细")),
                "Standard 单场不得含 Potential Damage 列：" + headers);
        for (final String keep : List.of("伤害", "射击次数", "命中次数", "击穿", "命中率", "击穿率",
                "贡献度", "KAST", "Impact")) {
            assertTrue(headers.contains(keep), "Standard 单场必须保留 " + keep + "：" + headers);
        }
    }

    @Test
    void aggregateDetailSheetContainsFullCanonicalPlayerSchema() throws Exception {
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Sheet detail = wb.getSheet("明细");
            assertNotNull(detail, "汇总工作簿必须含明细表");
            final Row header = detail.getRow(0);
            final List<String> headers = new ArrayList<>();
            for (int c = 0; c < header.getLastCellNum(); c++) {
                headers.add(header.getCell(c).getStringCellValue());
            }
            // battle context 打头（batch 可追踪）
            for (final String head : List.of("文件名", "竞技场ID", "日期", "地图", "胜负")) {
                assertTrue(headers.contains(head), "Replay 明细必须含 " + head + "，实际：" + headers);
            }
            // 完整 canonical Columns.PLAYER（单一 schema 源，不是 STAT 子集）
            for (final Columns.Column col : Columns.PLAYER) {
                assertTrue(headers.contains(col.title()),
                        "Replay 明细必须含 canonical 字段：" + col.title() + "，实际：" + headers);
            }
            // 玩家/战队/车辆 只出现一次（contextual head 不得重复 canonical 列）
            for (final String once : List.of("玩家", "战队", "车辆")) {
                assertEquals(1, headers.stream().filter(once::equals).count(), once + " 不得在明细表重复，实际：" + headers);
            }
            // 此前容易丢失的字段必须存在（不依赖行数断言）
            for (final String missing : List.of("等级", "坦克类型", "国家", "炮伤",
                    "被命中", "被击穿", "击伤", "排", "军阶", "车辆ID", "账号ID",
                    "贡献度", "KAST", "Impact")) {
                assertTrue(headers.contains(missing), "此前缺失字段必须存在：" + missing + "，实际：" + headers);
            }
            assertTrue(headers.stream().noneMatch(h -> h.contains("潜在伤害") || h.contains("补增伤害")
                            || h.contains("潜在明细")),
                    "Potential Damage 已全局移除，Standard 汇总明细也不得含：" + headers);
            // 文件名/竞技场ID 有值
            final String text = sheetTextAll(detail);
            assertTrue(text.contains("one.wotbreplay") && text.contains("two.wotbreplay"),
                    "明细必须含文件名列值（batch 可追踪）");
            assertTrue(text.contains("arena-1") && text.contains("arena-2"), "明细必须含竞技场ID列值");
        }
    }

    @Test
    void leagueDimensionExcelTitlesCoverAllCanonicalKeys() throws Exception {
        // League Excel 七维标题必须由 canonical DIM_KEYS 驱动（key set 全量覆盖，禁止 positional list）。
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(battle), List.of(result), List.of());
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(battle), List.of("one.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            for (final String sheetName : List.of("选手汇总", "战队汇总", "每场明细")) {
                final String header = headerText(wb.getSheet(sheetName));
                int dimColumns = 0;
                for (final String key : LeagueColumns.DIM_KEYS) {
                    final String title = dimensionTitleOracle(key);
                    final String needle = sheetName.equals("每场明细") ? title : title + "中位数";
                    assertEquals(1, countOccurrences(header, needle),
                            sheetName + " 必须恰好含 " + key + " 的标题：" + needle + "，实际表头：" + header);
                    dimColumns++;
                }
                assertEquals(LeagueColumns.DIM_KEYS.size(), dimColumns,
                        sheetName + " 维度标题列数必须 == LeagueColumns.DIM_KEYS.size()");
            }
        }
    }

    @Test
    void aggregateDetailPlatoonLabelsRestartPerBattle() throws Exception {
        // 排号语义按单场 Battle 独立：battle 1 三个 platoon → A/B/C；
        // battle 2 两个不同 platoon → 必须重新从 A/B 开始（不得接续 C/D 或共享映射）。
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        setDistinctPlatoons(b1, 3);
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        setDistinctPlatoons(b2, 2);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), Tankopedia.load(), out);
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Sheet detail = wb.getSheet("明细");
            final Row header = detail.getRow(0);
            int platoonCol = -1;
            for (int c = 0; c < header.getLastCellNum(); c++) {
                if ("排".equals(header.getCell(c).getStringCellValue())) {
                    platoonCol = c;
                }
            }
            assertTrue(platoonCol >= 0, "明细必须含 排 列");
            final List<String> battle1 = new ArrayList<>();
            final List<String> battle2 = new ArrayList<>();
            for (int r = 1; r <= 14; r++) {
                battle1.add(cellText(detail.getRow(r), platoonCol));
            }
            for (int r = 15; r <= 28; r++) {
                battle2.add(cellText(detail.getRow(r), platoonCol));
            }
            // 同一场多个 platoon：A/B/C 正常递增
            assertEquals(3, new java.util.HashSet<>(battle1).size(), "battle 1 应有 3 个不同排标签");
            assertTrue(battle1.contains("A") && battle1.contains("B") && battle1.contains("C"),
                    "battle 1 排标签必须为 A/B/C，实际 " + battle1);
            // 跨 battle 重新从 A 开始：battle 2 不得接续 battle 1 的映射
            assertEquals("A", battle2.getFirst(), "battle 2 第一个排必须重新从 A 开始（跨 battle 不得共享映射）");
            assertTrue(!battle2.contains("C") && !battle2.contains("D"),
                    "battle 2 不得出现 battle 1 的延续标签，实际 " + battle2);
        }
    }

    @Test
    void aggregateSummaryHeaderExactlyMatchesCanonicalColumns() throws Exception {
        // 汇总列集合必须恰好 == canonical AggregateColumns.CORE + PERFORMANCE：
        // 任何 missing / unexpected / duplicate 都会使「列数相等 + 标题恰好出现一次」失败。
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), Tankopedia.load(), out);
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Row header = wb.getSheet("汇总").getRow(0);
            final List<String> headers = new ArrayList<>();
            for (int c = 0; c < header.getLastCellNum(); c++) {
                headers.add(header.getCell(c).getStringCellValue());
            }
            final int canonicalCount = AggregateColumns.CORE.size() + AggregateColumns.PERFORMANCE.size();
            assertEquals(canonicalCount, headers.size(),
                    "汇总列数必须 == canonical AggregateColumns 列数（unexpected 列会破坏该计数）");
            for (final AggregateColumns.CoreColumn c : AggregateColumns.CORE) {
                assertEquals(1, headers.stream().filter(h -> h.equals(summaryTitle(c.key()))).count(),
                        "canonical 列必须恰好出现一次（missing/duplicate 均失败）：" + c.key());
            }
            for (final AggregateColumns.PerfColumn c : AggregateColumns.PERFORMANCE) {
                assertEquals(1, headers.stream().filter(h -> h.equals(summaryTitle(c.key()))).count(),
                        "canonical 列必须恰好出现一次（missing/duplicate 均失败）：" + c.key());
            }
        }
    }

    @Test
    void leagueSummariesLabelRatedSampleAsScoredBattles() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(battle), List.of(result), List.of());
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(battle), List.of("one.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            // rated-only sample：League 专属 summary 不得叫「场次」（与 Replay 汇总解析场次语义冲突）
            assertEquals("评分场次", wb.getSheet("选手汇总").getRow(0).getCell(2).getStringCellValue(),
                    "选手汇总场次列必须准确表达 rated sample");
            assertEquals("评分场次", wb.getSheet("战队汇总").getRow(0).getCell(1).getStringCellValue(),
                    "战队汇总场次列必须准确表达 rated sample");
        }
    }

    @Test
    void aggregatePlayerExportUsesV5MainRatingAndKeepsRawMedian() throws Exception {
        // V5：批次选手汇总主 Rating = Evidence Adjustment 后；原始中位数独立列。
        // 单场明细仍 = V4.1 finalRating（battle scope 不得被 V5 污染）。
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(battle), List.of(result), List.of());
        final PlayerLeagueSummary s = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(battle), List.of("one.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Sheet players = wb.getSheet("选手汇总");
            final String header = headerText(players);
            assertTrue(header.contains("总Rating"), "选手汇总主列必须为 总Rating（V5），实际：" + header);
            assertTrue(header.contains("原始中位数"), "选手汇总必须含 Raw Observed Median 列，实际：" + header);
            // 行值：总Rating = batchRatingV5；原始中位数 = ratingMedian
            final Row row = players.getRow(1);
            assertEquals(Math.round(s.batchRatingV5() * 10) / 10.0,
                    row.getCell(3).getNumericCellValue(), 1e-9, "总Rating 列必须 = V5");
            assertEquals(Math.round(s.ratingMedian() * 10) / 10.0,
                    row.getCell(4).getNumericCellValue(), 1e-9, "原始中位数列必须 = Raw Median");
            // 单场明细：Rating 仍为 V4.1 finalRating（不得显示 V5）
            final Sheet detail = wb.getSheet("每场明细");
            final String detailHeader = headerText(detail);
            assertTrue(detailHeader.contains("总Rating"), "单场明细保留 总Rating 列（V4.1 语义）");
            assertEquals(Math.round(result.byAccount(1001).finalRating() * 10) / 10.0,
                    detail.getRow(1).getCell(6).getNumericCellValue(), 1e-9,
                    "单场明细 Rating 必须 = V4.1 finalRating");
        }
    }

    @Test
    void leagueSummaryDimensionMedianCountMatchesCanonicalDimensionKeys() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(battle), List.of(result), List.of());
        // chunkMedians 输出维度数必须 == canonical DIM_KEYS（禁止 magic 7）
        assertEquals(LeagueColumns.DIM_KEYS.size(),
                batch.playerSummaries().getFirst().dimensionMedians().size(),
                "选手维度中位数数量必须 == LeagueColumns.DIM_KEYS.size()");
        assertEquals(LeagueColumns.DIM_KEYS.size(),
                batch.teamSummaries().getFirst().dimensionMedians().size(),
                "战队维度中位数数量必须 == LeagueColumns.DIM_KEYS.size()");

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(battle), List.of("one.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final Row header = wb.getSheet("选手汇总").getRow(0);
            int medianCount = 0;
            for (int c = 0; c < header.getLastCellNum(); c++) {
                final String title = header.getCell(c).getStringCellValue();
                // 维度中位数列（排除 原始中位数（V5 explainability）与 战队Rating中位数）
                if (title.endsWith("中位数") && !title.equals("原始中位数")
                        && !title.equals("战队Rating中位数")) {
                    medianCount++;
                }
            }
            assertEquals(LeagueColumns.DIM_KEYS.size(), medianCount,
                    "Excel 维度中位数列数必须 == LeagueColumns.DIM_KEYS.size()（禁止 magic 7）");
        }
    }

    private static Workbook writeSingle(final Battle battle) throws Exception {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingle(battle, Tankopedia.load(), out);
        return new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()));
    }

    private static Workbook writeSingleLeague(final Battle battle, final LeagueRatingResult result) throws Exception {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingleLeague(battle, result, Tankopedia.load(), out);
        return new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()));
    }

    private static List<String> battleInfoKeys(final Workbook wb) {
        final List<String> keys = new ArrayList<>();
        final Sheet info = wb.getSheet("战斗信息");
        for (int r = 2; r <= info.getLastRowNum(); r++) {
            final Row row = info.getRow(r);
            if (row == null || row.getCell(0) == null) {
                continue;
            }
            keys.add(row.getCell(0).getStringCellValue());
        }
        return keys;
    }

    private static List<String> rawHeaders(final Workbook wb) {
        final Sheet raw = wb.getSheet("原始字段");
        final Row header = raw.getRow(0);
        final List<String> out = new ArrayList<>();
        for (int c = 0; c < header.getLastCellNum(); c++) {
            out.add(header.getCell(c).getStringCellValue());
        }
        return out;
    }

    @Test
    void aggregateLeagueWorkbookAppliesTeamKeyOverride() throws Exception {
        // 两场 team1 均 clan=AAA → 批次 teamKey = clan:AAA（批次 identity override）
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
        // （Test 1）：battle override 必须进入「每场明细」，不得仍是 Team 1/Team 2
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
        // （Test 2）：battle override 只改单场明细；战队汇总仍走 autoName（AAA）
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
    void aggregateLeaguePartialRatingsListsAllBattlesDetailsOnlyRated() throws Exception {
        // Rating-ineligible battles remain part of the parsed Replay dataset:
        // 每场明细只含 eligible（无 Rating 的场次没有 Rating 明细行）；
        // 战斗列表列出全部 battle 且 ineligible 场显示真实 failure 状态，不重复行、不崩溃。
        final Battle b1 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b1.arenaId = "arena-1";
        final Battle b2 = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b2.arenaId = "arena-2";
        b2.settlementAccountsCoveredByRoster = false;
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(b1);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(b1), List.of(r1),
                List.of(new LeagueFailure("two.wotbreplay", "arena-2", LeagueFailure.Code.ROSTER_INCOMPLETE)));

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregateLeague(List.of(b1, b2), List.of("one.wotbreplay", "two.wotbreplay"),
                List.of(), batch, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            final String detail = sheetTextAll(wb.getSheet("每场明细"));
            assertTrue(detail.contains("arena-1"), "每场明细必须含 eligible 场");
            assertTrue(!detail.contains("arena-2"), "每场明细不得含 Rating-ineligible 场（无 Rating 明细）");
            final String list = sheetTextAll(wb.getSheet("战斗列表"));
            assertTrue(list.contains("arena-2"), "战斗列表必须列出全部解析 battle（含 ineligible）");
            assertTrue(list.contains("名册不完整"), "ineligible 场状态必须显示真实 failure 文案，实际：" + list);
            assertEquals(1, countOccurrences(list, "已评分"), "只有 eligible 场标记已评分，实际：" + list);
            assertEquals(1, countOccurrences(list, "名册不完整"), "ineligible 场不得因 battle 行 + failure 行重复，实际：" + list);
        }
    }

    private static int countOccurrences(final String text, final String needle) {
        int count = 0;
        int idx = 0;
        while ((idx = text.indexOf(needle, idx)) != -1) {
            count++;
            idx += needle.length();
        }
        return count;
    }

    @Test
    void aggregateSummaryOverrideDoesNotLeakIntoDetailSheet() throws Exception {
        // （Test 3）：summary override 只改战队汇总；每场明细仍用 autoName（AAA）
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
