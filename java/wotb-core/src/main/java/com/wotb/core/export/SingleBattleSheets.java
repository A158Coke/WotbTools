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
        // 玩家数据在前（用户最关心的数据，Excel 打开即见，不再是大片空白的信息表）；
        // 战斗信息 / 原始字段 保留在后续 sheet。显式指定 active sheet 保证默认打开「玩家数据」。
        players(styles, battle, tp);
        writeBattleInfo(styles, battle, null);
        writeRaw(styles, battle);
        styles.workbook().setActiveSheet(0);
    }

    /**
     * canonical Replay 单场战斗信息（Standard / League 单场共用的<b>唯一</b> base 事实源）：
     * 游戏版本 / 地图 / 开始时间 / 战斗时长 / 获胜队伍 / 录像者 / 录像者车辆 / 玩家数 / 竞技场ID。
     * League 只通过 {@code extraRows} 追加自身扩展（Team Rating / MVP / 队内最佳），
     * 绝不再复制 base list。
     *
     * @param keyWidth 首列宽度（Standard 14；League 因扩展行更长可放宽，presentation 参数）
     */
    static void writeBattleInfo(final ExcelStyles styles, final Battle b, final List<String[]> extraRows) {
        writeBattleInfo(styles, b, extraRows, 14);
    }

    static void writeBattleInfo(final ExcelStyles styles, final Battle b, final List<String[]> extraRows,
                                final int keyWidth) {
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

        final List<String[]> rows = new ArrayList<>(List.of(
                new String[]{"游戏版本", b.version},
                new String[]{"地图", MapNames.cn(b.mapName)},
                new String[]{"开始时间", ExcelStyles.fmt(b.startTime, ExcelStyles.DT)},
                new String[]{"战斗时长", ExcelStyles.duration(b.durationS)},
                new String[]{"获胜队伍", Players.TEAM_NAME.getOrDefault(b.winnerTeam == null ? 0 : b.winnerTeam, "平局/未知")},
                new String[]{"录像者", b.recorder},
                new String[]{"录像者车辆", b.recorderVehicle},
                new String[]{"玩家数", String.valueOf(b.nPlayers())},
                new String[]{"竞技场ID", b.arenaId}
        ));
        if (extraRows != null) {
            rows.addAll(extraRows);
        }
        final Font bold = wb.createFont();
        bold.setBold(true);
        final CellStyle boldStyle = wb.createCellStyle();
        boldStyle.setFont(bold);
        for (int i = 0; i < rows.size(); i++) {
            final Row r = ws.createRow(i + 2);
            final Cell k = r.createCell(0);
            k.setCellValue(rows.get(i)[0]);
            k.setCellStyle(boldStyle);
            r.createCell(1).setCellValue(rows.get(i)[1] == null ? "" : rows.get(i)[1]);
        }
        ws.setColumnWidth(0, keyWidth * 256);
        ws.setColumnWidth(1, 40 * 256);
    }

    private static void players(final ExcelStyles styles, final Battle b, final Tankopedia tp) {
        writePlayers(styles, b, tp, null, null);
    }

    /**
     * 玩家数据 sheet：canonical {@link Columns#PLAYER}（Standard/League 单场共用的唯一
     * Replay 字段 schema 源）+ 可选 League 专属扩展列（表头 + 行尾回调）。
     * League 只追加自身 extension，绝不复制 canonical 字段列表。
     */
    static void writePlayers(final ExcelStyles styles, final Battle b, final Tankopedia tp,
                             final List<String[]> extraHeader, final PlayerRowTail tail) {
        final Sheet ws = styles.workbook().createSheet("玩家数据");
        final List<Columns.Column> columns = Columns.PLAYER;
        final List<String[]> header = new ArrayList<>(columns.stream()
                .map(c -> new String[]{c.title(), String.valueOf(c.xlsx())}).toList());
        if (extraHeader != null) {
            header.addAll(extraHeader);
        }
        styles.writeHeader(ws, header);

        final List<PlayerResult> players = Players.sorted(b.players);
        for (final PlayerResult p : players) {
            Players.enrich(p, tp);
        }
        int rIdx = 1;
        for (final PlayerResult p : players) {
            final Row row = ws.createRow(rIdx++);
            final CellStyle fill = p.team == 1 ? styles.team1() : styles.team2();
            int c = 0;
            for (final Columns.Column column : columns) {
                styles.setCell(row.createCell(c), playerColumnValue(column, p), fill, column.key());
                c++;
            }
            if (tail != null) {
                tail.accept(row, p, fill, c);
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, players.size(), 0, header.size() - 1));
    }

    /** 玩家数据行扩展回调（在 canonical 列之后追加 League 专属单元格；startCol = canonical 列数）。 */
    @FunctionalInterface
    interface PlayerRowTail {
        void accept(Row row, PlayerResult p, CellStyle fill, int startCol);
    }

    /**
     * canonical 玩家单元格取值（Standard / League 单场 / Aggregate 明细共用同一业务取值与
     * formatting）：{@code survival_time} 渲染为时长，其余列直接读 {@link Columns.Column#get()}。
     */
    static Object playerColumnValue(final Columns.Column column, final PlayerResult p) {
        return "survival_time".equals(column.key())
                ? ExcelStyles.duration((Double) column.get().apply(p))
                : column.get().apply(p);
    }

    /** canonical 原始字段表（Standard / League 单场共用的唯一 protobuf field-number 透视 writer）。 */
    static void writeRaw(final ExcelStyles styles, final Battle b) {
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
