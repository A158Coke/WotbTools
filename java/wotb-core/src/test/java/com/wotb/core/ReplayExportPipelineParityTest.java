package com.wotb.core;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.stats.Aggregator;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.Players;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
    void excelSingleSheetOmitsRetiredColumnsAndKeepsCanonicalFacts() throws Exception {
        // B6：单场「玩家数据」表不再含 contribution/kast/impact（已退役表现指标）、
        // 互换击杀、身份列（账号ID/车辆ID，身份不属展示列）与 炮伤（alpha_damage）。
        // 保留列仍必须与同一 authoritative Battle 同源（Excel 与网页共用列 getter）。
        final byte[] bytes = Files.readAllBytes(fixture());
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle full = facade.process(new Source("x.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        PerformanceMetricsCalculator.populateBattle(full);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingle(full, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new java.io.ByteArrayInputStream(out.toByteArray()))) {
            final Sheet sheet = wb.getSheet("玩家数据");
            assertTrue(sheet != null, "单场工作簿必须含「玩家数据」sheet");
            final Row header = sheet.getRow(0);
            final List<String> titles = headerTitles(header);
            for (final String retired : List.of("贡献度", "KAST", "Impact", "互换击杀",
                    "账号ID", "车辆ID", "炮伤")) {
                assertFalse(titles.contains(retired), "单场玩家数据不得再含已退役列：" + retired + "，实际：" + titles);
            }
            final int damageIdx = columnIndex(header, "伤害");

            // 保留列数值必须 == 同一 authoritative Battle（写入顺序 = Players.sorted）
            final List<PlayerResult> players = Players.sorted(full.players);
            assertEquals(players.size(), sheet.getLastRowNum(), "玩家数据行数必须覆盖全部参战者");
            for (int i = 0; i < players.size(); i++) {
                final Row row = sheet.getRow(i + 1);
                assertNotNull(row, "玩家数据必须逐行覆盖参战者");
                assertEquals((double) players.get(i).damageDealt,
                        row.getCell(damageIdx).getNumericCellValue(), 0.001,
                        "Excel 伤害 == authoritative Battle 值 (acc " + players.get(i).accountId + ")");
            }
        }
    }

    @Test
    void excelAggregateSummaryMultiDamageRateMatchesComputeRowsHpKnown() throws Exception {
        // Case A（aggregate）：HP known 时「汇总」sheet 的多伤率列必须 == compute() 对应 Row 值
        // （与 API Mapper.toAggregate 共用 canonical getter）。身份由行序承载（账号ID 列已退役），
        // 行序复刻 AggregateSheets 的「场均伤害降序」。
        final byte[] bytes = Files.readAllBytes(fixture());
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle b1 = facade.process(new Source("a.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        final Battle b2 = facade.process(new Source("b.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();
        b2.arenaId = b1.arenaId + "-dup-arena";   // 避免外部去重假设；AggregateSheets 按传入列表直接聚合

        final List<Battle> battles = List.of(b1, b2);
        final Map<Long, PerformanceMetricsCalculator.Row> perfById = new HashMap<>();
        for (final PerformanceMetricsCalculator.Row r : PerformanceMetricsCalculator.compute(battles)) {
            perfById.put(r.accountId, r);
        }
        final List<Agg> ordered = new ArrayList<>(Aggregator.aggregate(battles).values());
        ordered.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(battles, List.of("a.wotbreplay", "b.wotbreplay"),
                List.of(), Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new java.io.ByteArrayInputStream(out.toByteArray()))) {
            final Sheet sheet = wb.getSheet("汇总");
            assertTrue(sheet != null, "汇总工作簿必须含「汇总」sheet");
            final int multiIdx = columnIndex(sheet.getRow(0), "多伤率%");
            assertEquals(ordered.size(), sheet.getLastRowNum(), "汇总数据行数必须 == 聚合选手数");
            for (int i = 0; i < ordered.size(); i++) {
                final long accountId = ordered.get(i).accountId;
                assertEquals(round1(perfById.get(accountId).multiDamageRate),
                        sheet.getRow(i + 1).getCell(multiIdx).getNumericCellValue(), 0.001,
                        "Excel aggregate multi_damage_rate == compute (acc " + accountId + ")");
            }
        }
    }

    @Test
    void excelAggregateSummaryHpUnknownKeepsMultiDamageRateUnavailable() throws Exception {
        // Case B（aggregate）：HP UNKNOWN（hpEligible=false）时多伤率必须为空单元格
        // （unavailable，不冒充 0）；已退役的 contribution/kast/impact/互换击杀 不得回魂。
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
            final Row header = sheet.getRow(0);
            final List<String> titles = headerTitles(header);
            for (final String retired : List.of("贡献度%", "KAST%", "Impact%", "互换击杀", "账号ID")) {
                assertFalse(titles.contains(retired), "汇总表不得再含已退役列：" + retired + "，实际：" + titles);
            }
            final int multiIdx = columnIndex(header, "多伤率%");
            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                final Row row = sheet.getRow(r);
                if (row == null) continue;
                assertNull(cellValue(row, multiIdx), "HP unknown 时多伤率必须为空（unavailable，不冒充 0）");
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

    /** 表头标题列表（顺序 = 列序）。 */
    private static List<String> headerTitles(final Row header) {
        final List<String> titles = new ArrayList<>();
        for (int c = 0; c < header.getLastCellNum(); c++) {
            titles.add(header.getCell(c).getStringCellValue());
        }
        return titles;
    }

    /** 按表头文本定位列 index（列集合变更后缺列立即失败，绝不静默用 -1）。 */
    private static int columnIndex(final Row header, final String title) {
        for (int c = 0; c < header.getLastCellNum(); c++) {
            if (title.equals(header.getCell(c).getStringCellValue())) {
                return c;
            }
        }
        throw new AssertionError("汇总/玩家数据表缺少列：" + title + "，实际表头：" + headerTitles(header));
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
