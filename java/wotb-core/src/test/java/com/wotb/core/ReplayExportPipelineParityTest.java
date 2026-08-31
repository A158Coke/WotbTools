package com.wotb.core;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 回归：preview 与 Excel export 必须消费同一 authoritative full processing Battle。
 *
 * <p>已提交夹具（random-battle-example，rift 随机战）证明：full processing 的 live death
 * observations 与 settlement projection 分层保存。若 export 走 raw parse，Excel 的派生指标
 * 仍必须来自同一个 full-processing Battle。</p>
 */
class ReplayExportPipelineParityTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        assertTrue(Files.isDirectory(dir), "common/fixtures/replays 必须存在（已提交夹具）");
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void fullProcessingAddsLiveObservationWithoutMutatingSettlement() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle raw = ReplayParser.parse(bytes);
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle full = facade.process(new Source("x.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();

        raw.players.sort(Comparator.comparingLong(p -> p.accountId));
        full.players.sort(Comparator.comparingLong(p -> p.accountId));
        assertEquals(14, raw.players.size());
        assertEquals(raw.players.size(), full.players.size());

        // Settlement projection remains identical; reconciliation no longer writes live precision
        // back into PlayerResult.
        boolean settlementDiffers = false;
        for (int i = 0; i < raw.players.size(); i++) {
            if (raw.players.get(i).deathTimeMillis != full.players.get(i).deathTimeMillis
                    || Double.compare(raw.players.get(i).settlementLifeTimeSec,
                    full.players.get(i).settlementLifeTimeSec) != 0
                    || raw.players.get(i).survived != full.players.get(i).survived) {
                settlementDiffers = true;
                break;
            }
        }
        assertTrue(!settlementDiffers, "full processing 不得修改 settlement projection");
        assertEquals(raw.players.size(), full.players.size(), "full processing preserves settlement players");
    }

    @Test
    void sameReplayFullProcessingIsDeterministic() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle first = facade.process(new Source("a.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        final Battle second = facade.process(new Source("b.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();

        first.players.sort(Comparator.comparingLong(p -> p.accountId));
        second.players.sort(Comparator.comparingLong(p -> p.accountId));
        for (int i = 0; i < first.players.size(); i++) {
            assertEquals(first.players.get(i).settlementLifeTimeSec,
                    second.players.get(i).settlementLifeTimeSec, 1e-6,
                    "同一 replay 两次 full processing 的 settlement projection 必须确定");
        }
    }

    @Test
    void excelSingleSheetMetricsMatchPopulatedBattle() throws Exception {
        // Case A：同一 authoritative Battle（full processing）→ Excel 单场「玩家数据」sheet 的
        // contribution/kast/impact 数值必须 == PerformanceMetricsCalculator 回填值（网页同源）。
        final byte[] bytes = Files.readAllBytes(fixture());
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle full = facade.process(new Source("x.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        PerformanceMetricsCalculator.populateBattle(full);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingle(full, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new java.io.ByteArrayInputStream(out.toByteArray()))) {
            final Sheet sheet = wb.getSheet("玩家数据");
            assertTrue(sheet != null, "单场工作簿必须含「玩家数据」sheet");
            // 表头行：找到 contribution/kast/impact 列 index
            final Row header = sheet.getRow(0);
            int contributionIdx = -1;
            int kastIdx = -1;
            int impactIdx = -1;
            int accountIdx = -1;
            for (int c = 0; c < header.getLastCellNum(); c++) {
                final String title = header.getCell(c).getStringCellValue();
                if ("贡献度".equals(title)) contributionIdx = c;
                else if ("KAST".equals(title)) kastIdx = c;
                else if ("Impact".equals(title)) impactIdx = c;
                else if ("账号ID".equals(title)) accountIdx = c;
            }
            assertTrue(contributionIdx >= 0 && kastIdx >= 0 && impactIdx >= 0 && accountIdx >= 0,
                    "Excel 玩家数据表必须包含 贡献度/KAST/Impact/账号ID 列");

            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                final Row row = sheet.getRow(r);
                if (row == null) continue;
                final long accountId = (long) row.getCell(accountIdx).getNumericCellValue();
                final PlayerResult p = full.players.stream()
                        .filter(pp -> pp.accountId == accountId).findFirst().orElseThrow();
                final double excelContribution = row.getCell(contributionIdx).getNumericCellValue();
                final double excelKast = row.getCell(kastIdx).getNumericCellValue();
                final double excelImpact = row.getCell(impactIdx).getNumericCellValue();
                // Excel 与网页 Columns.PLAYER 同源：getter 直接读 PlayerResult 原始值（不 r1）。
                // 前端负责展示格式化（% 与 1 位小数）；underlying numeric value 必须一致。
                assertEquals(p.contribution, excelContribution, 0.001,
                        "Excel contribution == populateBattle 值 (acc " + accountId + ")");
                assertEquals(p.kast, excelKast, 0.001,
                        "Excel kast == populateBattle 值 (acc " + accountId + ")");
                assertEquals(p.impact, excelImpact, 0.001,
                        "Excel impact == populateBattle 值 (acc " + accountId + ")");
            }
        }
    }

    @Test
    void excelAggregateSummaryMetricsMatchComputeRowsHpKnown() throws Exception {
        // Case A（aggregate）：HP known 时，「汇总」sheet 的 5 列必须 == compute() 对应 Row 值
        // （与 API Mapper.toAggregate 同一契约；用真实 fixture 的 full processing Battle）。
        final byte[] bytes = Files.readAllBytes(fixture());
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle b1 = facade.process(new Source("a.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        final Battle b2 = facade.process(new Source("b.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        b2.arenaId = b1.arenaId + "-dup-arena";   // 避免外部去重假设；AggregateSheets 按传入列表直接聚合

        final List<Battle> battles = List.of(b1, b2);
        final List<PerformanceMetricsCalculator.Row> rows = PerformanceMetricsCalculator.compute(battles);
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(battles, List.of("a.wotbreplay", "b.wotbreplay"),
                List.of(), Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new java.io.ByteArrayInputStream(out.toByteArray()))) {
            final Sheet sheet = wb.getSheet("汇总");
            assertTrue(sheet != null, "汇总工作簿必须含「汇总」sheet");
            final int[] idx = aggregateColumnIndexes(sheet.getRow(0));
            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                final Row row = sheet.getRow(r);
                if (row == null) continue;
                final long accountId = (long) row.getCell(idx[4]).getNumericCellValue();
                final PerformanceMetricsCalculator.Row perf = rows.stream()
                        .filter(x -> x.accountId == accountId).findFirst().orElseThrow();
                assertEquals(round1(perf.contribution), row.getCell(idx[0]).getNumericCellValue(), 0.001,
                        "Excel aggregate contribution == compute (acc " + accountId + ")");
                assertEquals(round1(perf.kast), row.getCell(idx[1]).getNumericCellValue(), 0.001,
                        "Excel aggregate kast == compute (acc " + accountId + ")");
                assertEquals(round1(perf.impactValue), row.getCell(idx[2]).getNumericCellValue(), 0.001,
                        "Excel aggregate impact == compute (acc " + accountId + ")");
                assertEquals(round1(perf.multiDamageRate), row.getCell(idx[3]).getNumericCellValue(), 0.001,
                        "Excel aggregate multi_damage_rate == compute (acc " + accountId + ")");
                assertEquals(perf.tradedDeaths, (int) row.getCell(idx[5]).getNumericCellValue(),
                        "Excel aggregate traded_deaths == compute (acc " + accountId + ")");
            }
        }
    }

    @Test
    void excelAggregateSummaryHpUnknownKeepsImpactAndTradedDeaths() throws Exception {
        // Case B（aggregate）：HP UNKNOWN（hpEligible=false）时，贡献度/KAST/多伤率必须为空单元格，
        // 但 Impact / 互换击杀 仍必须为数值——防止再次出现「hpEligible=false => 全部 blank」回归。
        final Battle b1 = battleUnknownHp(1);
        final Battle b2 = battleUnknownHp(2);
        final List<Battle> battles = List.of(b1, b2);
        final List<PerformanceMetricsCalculator.Row> rows = PerformanceMetricsCalculator.compute(battles);
        assertTrue(rows.stream().allMatch(r -> !r.hpEligible), "夹具必须为 hpEligible=false");

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(battles, List.of("u1.wotbreplay", "u2.wotbreplay"),
                List.of(), Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new java.io.ByteArrayInputStream(out.toByteArray()))) {
            final Sheet sheet = wb.getSheet("汇总");
            final int[] idx = aggregateColumnIndexes(sheet.getRow(0));
            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                final Row row = sheet.getRow(r);
                if (row == null) continue;
                // contribution / kast / multi_damage_rate：空单元格（unavailable，不冒充 0）
                assertNull(cellValue(row, idx[0]), "HP unknown 时贡献度必须为空");
                assertNull(cellValue(row, idx[1]), "HP unknown 时 KAST 必须为空");
                assertNull(cellValue(row, idx[3]), "HP unknown 时多伤率必须为空");
                // impact / traded_deaths：不依赖 HP，仍为数值
                assertTrue(row.getCell(idx[2]) != null && row.getCell(idx[2]).getCellType() != org.apache.poi.ss.usermodel.CellType.BLANK,
                        "HP unknown 时 Impact 必须仍为数值");
                assertTrue(row.getCell(idx[5]) != null && row.getCell(idx[5]).getCellType() != org.apache.poi.ss.usermodel.CellType.BLANK,
                        "HP unknown 时互换击杀必须仍为数值");
                assertEquals(round1(rows.stream().filter(x -> x.accountId == (long) row.getCell(idx[4]).getNumericCellValue())
                                .findFirst().orElseThrow().impactValue),
                        row.getCell(idx[2]).getNumericCellValue(), 0.001,
                        "HP unknown 时 Excel impact 必须 == compute 值");
            }
        }
    }

    /** 14 人但 tankId=-1（tankopedia 无 base HP、无 entryHp）→ BattleHpFacts.averageHp incomplete。 */
    private static Battle battleUnknownHp(final int arenaSuffix) {
        final Battle battle = new Battle();
        battle.arenaId = "unknown-hp-" + arenaSuffix;
        battle.winnerTeam = 1;
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = i + 1L + arenaSuffix * 100L;
            p.nickname = "p" + p.accountId;
            p.team = i < 7 ? 1 : 2;
            p.tankId = -1;
            p.damageDealt = 2600 - i * 100;
            p.kills = 2;
            players.add(p);
        }
        battle.players = players;
        return battle;
    }

    /** 汇总表 5 个派生列 + 账号ID 的列 index：[0]=贡献度 [1]=KAST [2]=Impact [3]=多伤率 [4]=账号ID [5]=互换击杀。 */
    private static int[] aggregateColumnIndexes(final Row header) {
        final int[] idx = new int[6];
        java.util.Arrays.fill(idx, -1);
        for (int c = 0; c < header.getLastCellNum(); c++) {
            final String title = header.getCell(c).getStringCellValue();
            if ("贡献度%".equals(title)) idx[0] = c;
            else if ("KAST%".equals(title)) idx[1] = c;
            else if ("Impact%".equals(title)) idx[2] = c;
            else if ("多伤率%".equals(title)) idx[3] = c;
            else if ("账号ID".equals(title)) idx[4] = c;
            else if ("互换击杀".equals(title)) idx[5] = c;
        }
        for (int i = 0; i < idx.length; i++) {
            assertTrue(idx[i] >= 0, "汇总表缺少列 index " + i);
        }
        return idx;
    }

    /** 空单元格/空字符串返回 null（ExcelStyles.setCell 对 null 写 ""，等价 API null 语义）。 */
    private static Object cellValue(final Row row, final int c) {
        final org.apache.poi.ss.usermodel.Cell cell = row.getCell(c);
        if (cell == null) return null;
        return switch (cell.getCellType()) {
            case BLANK -> null;
            case NUMERIC -> cell.getNumericCellValue();
            case STRING -> cell.getStringCellValue().isEmpty() ? null : cell.getStringCellValue();
            default -> cell.toString();
        };
    }

    private static double round1(final double v) {
        return Math.round(v * 10) / 10.0;
    }

}
