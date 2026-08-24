package com.wotb.core;

import com.wotb.core.export.ExcelExporter;
import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 回归（plan §28/§42）：单场 XLSX 默认打开「玩家数据」，表顺序为 玩家数据/战斗信息/原始字段。 */
class ExcelExportSheetOrderTest {

    @Test
    void singleBattleWorkbookHasPlayersFirstAndActive() throws Exception {
        final Path fixture = fixture();
        final byte[] bytes = Files.readAllBytes(fixture);
        final Battle battle = ReplayParser.parse(bytes);
        assertTrue(battle.nPlayers() >= 2, "fixture 应有玩家");

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExcelExporter.writeSingle(battle, Tankopedia.load(), out);

        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            assertEquals(3, wb.getNumberOfSheets());
            assertEquals("玩家数据", wb.getSheetName(0), "玩家数据必须是第一个 sheet");
            assertEquals("战斗信息", wb.getSheetName(1));
            assertEquals("原始字段", wb.getSheetName(2));
            final Sheet active = wb.getSheetAt(wb.getActiveSheetIndex());
            assertEquals("玩家数据", active.getSheetName(), "默认 active sheet 必须是玩家数据");
        }
    }

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        assertTrue(Files.isDirectory(dir), "common/fixtures/replays 必须存在（已提交夹具）");
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }
}
