package com.wotb.core;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.replay.facts.TradeFacts;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 回归：preview 与 Excel export 必须消费同一 authoritative full processing Battle。
 *
 * <p>已提交夹具（random-battle-example，rift 随机战）天然证明：raw parse 的死亡时间启发式
 * 与 {@code DeathTimeReconciler} 校准结果不同，导致 survivalTimeSec / TradeFacts.tradedDeaths /
 * KAST 不同。若 export 走 raw parse，Excel 的 KAST / 互换击杀 将与网页 preview 不一致。</p>
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
    void rawParseDeathTimeDiffersFromFullProcessing() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle raw = ReplayParser.parse(bytes);
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final Battle full = facade.process(new Source("x.wotbreplay", bytes), ReplayProcessingOptions.full()).battle();

        raw.players.sort(Comparator.comparingLong(p -> p.accountId));
        full.players.sort(Comparator.comparingLong(p -> p.accountId));
        assertEquals(14, raw.players.size());
        assertEquals(raw.players.size(), full.players.size());

        // 至少存在一名玩家：raw 与 full 的死亡时刻/存活时间不同（DeathTimeReconciler 校准 vs 启发式）
        boolean survivalDiffers = false;
        for (int i = 0; i < raw.players.size(); i++) {
            if (Math.abs(raw.players.get(i).survivalTimeSec - full.players.get(i).survivalTimeSec) > 1e-6) {
                survivalDiffers = true;
                break;
            }
        }
        assertTrue(survivalDiffers,
                "夹具必须证明 raw parse 与 full processing 的死亡时间不同（否则无法验证 pipeline 差异）");

        // 至少一名玩家 tradedDeaths 不同 → KAST tradeScore / 互换击杀列会随 pipeline 变化
        boolean tradeDiffers = false;
        for (int i = 0; i < raw.players.size(); i++) {
            final int rawTraded = TradeFacts.tradedDeaths(raw.players.get(i), raw.players);
            final int fullTraded = TradeFacts.tradedDeaths(full.players.get(i), full.players);
            if (rawTraded != fullTraded) {
                tradeDiffers = true;
                break;
            }
        }
        assertTrue(tradeDiffers,
                "夹具必须证明 raw 与 full 的互换击杀判定不同（tradedDeaths 随 pipeline 变化）");
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
            assertEquals(first.players.get(i).survivalTimeSec, second.players.get(i).survivalTimeSec, 1e-6,
                    "同一 replay 两次 full processing 的死亡时间必须确定（export 与 preview 同源）");
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

}
