package com.wotb.core.export;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.Columns;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Players;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellRangeAddress;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.function.Function;

/** 单场工作簿的三张表: 战斗信息 / 玩家数据 / 原始字段。 */
final class SingleBattleSheets {

    private SingleBattleSheets() {
    }

    static void write(final ExcelStyles styles, final Battle battle, final Tankopedia tp) {
        battleInfo(styles, battle);
        players(styles, battle, tp);
        raw(styles, battle);
    }

    private static void battleInfo(final ExcelStyles styles, final Battle b) {
        final Workbook wb = styles.workbook();
        final Sheet ws = wb.createSheet("战斗信息");
        final Font big = wb.createFont();
        big.setBold(true);
        big.setFontHeightInPoints((short) 14);
        final CellStyle title = wb.createCellStyle();
        title.setFont(big);
        final Row r0 = ws.createRow(0);
        final Cell c0 = r0.createCell(0);
        c0.setCellValue("战斗信息");
        c0.setCellStyle(title);

        final String[][] rows = {
                {"游戏版本", b.version},
                {"地图", MapNames.cn(b.mapName)},
                {"开始时间", ExcelStyles.fmt(b.startTime, ExcelStyles.DT)},
                {"战斗时长", ExcelStyles.duration(b.durationS)},
                {"获胜队伍", Players.TEAM_NAME.getOrDefault(b.winnerTeam == null ? 0 : b.winnerTeam, "平局/未知")},
                {"录像者", b.recorder},
                {"录像者车辆", b.recorderVehicle},
                {"玩家数", String.valueOf(b.nPlayers())},
                {"竞技场ID", b.arenaId},
        };
        final Font bold = wb.createFont();
        bold.setBold(true);
        final CellStyle boldStyle = wb.createCellStyle();
        boldStyle.setFont(bold);
        for (int i = 0; i < rows.length; i++) {
            final Row r = ws.createRow(i + 2);
            final Cell k = r.createCell(0);
            k.setCellValue(rows[i][0]);
            k.setCellStyle(boldStyle);
            r.createCell(1).setCellValue(rows[i][1] == null ? "" : rows[i][1]);
        }
        ws.setColumnWidth(0, 14 * 256);
        ws.setColumnWidth(1, 40 * 256);
    }

    private static void players(final ExcelStyles styles, final Battle b, final Tankopedia tp) {
        final Sheet ws = styles.workbook().createSheet("玩家数据");
        final List<Columns.Column> columns = Columns.PLAYER;
        styles.writeHeader(ws, columns.stream().map(c -> new String[]{c.title(), String.valueOf(c.xlsx())}).toList());

        final List<PlayerResult> players = Players.sorted(b.players);
        final Function<Long, String> platoon = Players.platoonLabeler();
        for (final PlayerResult p : players) {
            Players.enrich(p, tp);
            p.platoonLabel = platoon.apply(p.platoonId);
        }
        int rIdx = 1;
        for (final PlayerResult p : players) {
            final Row row = ws.createRow(rIdx++);
            final CellStyle fill = p.team == 1 ? styles.team1() : styles.team2();
            for (int c = 0; c < columns.size(); c++) {
                final Columns.Column column = columns.get(c);
                final Object val = "survival_time".equals(column.key())
                        ? ExcelStyles.duration((Double) column.get().apply(p))
                        : column.get().apply(p);
                styles.setCell(row.createCell(c), val, fill, column.key());
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, players.size(), 0, columns.size() - 1));
    }

    private static void raw(final ExcelStyles styles, final Battle b) {
        final Sheet ws = styles.workbook().createSheet("原始字段");
        final TreeSet<Integer> fieldNums = new TreeSet<>();
        for (final PlayerResult p : b.players) {
            if (p.raw != null) {
                fieldNums.addAll(p.raw.keySet());
            }
        }
        final List<Integer> cols = new ArrayList<>(fieldNums);
        final Row h = ws.createRow(0);
        styles.cell(h, 0, "玩家", styles.hdr());
        styles.cell(h, 1, "账号ID", styles.hdr());
        for (int i = 0; i < cols.size(); i++) {
            styles.cell(h, i + 2, "#" + cols.get(i), styles.hdr());
        }
        final List<PlayerResult> players = Players.sorted(b.players);
        int rIdx = 1;
        for (final PlayerResult p : players) {
            final Row row = ws.createRow(rIdx++);
            row.createCell(0).setCellValue(p.nickname);
            row.createCell(1).setCellValue(p.accountId);
            for (int i = 0; i < cols.size(); i++) {
                final List<Object> vals = p.raw == null ? null : p.raw.get(cols.get(i));
                if (vals == null) {
                    continue;
                }
                final StringBuilder sb = new StringBuilder();
                for (final Object v : vals) {
                    if (!sb.isEmpty()) {
                        sb.append(", ");
                    }
                    sb.append(v instanceof byte[] ? ExcelStyles.toHex((byte[]) v) : String.valueOf(v));
                }
                row.createCell(i + 2).setCellValue(sb.toString());
            }
        }
    }
}
