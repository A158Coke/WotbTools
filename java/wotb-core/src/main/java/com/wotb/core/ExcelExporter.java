package com.wotb.core;

import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.IOException;
import java.io.OutputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** 导出 xlsx (POI): 单场 / 多场汇总。 */
public final class ExcelExporter {

    private static final DateTimeFormatter DT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter DT_MIN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    /** 汇总表的一列。 */
    private record AggCol(String title, int xlsx, boolean num, Function<Agg, Object> get) {
    }

    private final Workbook wb;
    private final CellStyle hdr, center, left, team1, team2, plain;

    private ExcelExporter() {
        wb = new XSSFWorkbook();
        Font hf = wb.createFont();
        hf.setBold(true);
        hf.setColor(IndexedColors.WHITE.getIndex());
        hdr = base();
        hdr.setFont(hf);
        hdr.setFillForegroundColor(IndexedColors.DARK_BLUE.getIndex());
        hdr.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        hdr.setAlignment(HorizontalAlignment.CENTER);
        center = base();
        center.setAlignment(HorizontalAlignment.CENTER);
        left = base();
        plain = base();
        team1 = base();
        tint(team1, (byte) 0xDD, (byte) 0xEB, (byte) 0xF7);
        team2 = base();
        tint(team2, (byte) 0xFC, (byte) 0xE4, (byte) 0xD6);
    }

    private CellStyle base() {
        CellStyle s = wb.createCellStyle();
        s.setBorderTop(BorderStyle.THIN);
        s.setBorderBottom(BorderStyle.THIN);
        s.setBorderLeft(BorderStyle.THIN);
        s.setBorderRight(BorderStyle.THIN);
        return s;
    }

    private void tint(final CellStyle s, final byte r, final byte g, final byte b) {
        ((org.apache.poi.xssf.usermodel.XSSFCellStyle) s).setFillForegroundColor(
                new org.apache.poi.xssf.usermodel.XSSFColor(new byte[]{r, g, b}, null));
        s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
    }

    // ---------------- 单场 ----------------
    public static void writeSingle(final Battle battle, final Tankopedia tp, final OutputStream out) throws IOException {
        Rating.compute(java.util.List.of(battle), tp);   // 基准=该场内
        ExcelExporter e = new ExcelExporter();
        e.sheetBattleInfo(battle);
        e.sheetPlayers(battle, tp);
        e.sheetRaw(battle);
        e.wb.write(out);
        e.wb.close();
    }

    private void sheetBattleInfo(final Battle b) {
        Sheet ws = wb.createSheet("战斗信息");
        Font big = wb.createFont();
        big.setBold(true);
        big.setFontHeightInPoints((short) 14);
        CellStyle title = wb.createCellStyle();
        title.setFont(big);
        Row r0 = ws.createRow(0);
        Cell c0 = r0.createCell(0);
        c0.setCellValue("战斗信息");
        c0.setCellStyle(title);

        String[][] rows = {
                {"游戏版本", b.version},
                {"地图", MapNames.cn(b.mapName)},
                {"开始时间", fmt(b.startTime, DT)},
                {"战斗时长", duration(b.durationS)},
                {"获胜队伍", Players.TEAM_NAME.getOrDefault(b.winnerTeam == null ? 0 : b.winnerTeam, "平局/未知")},
                {"录像者", b.recorder},
                {"录像者车辆", b.recorderVehicle},
                {"玩家数", String.valueOf(b.nPlayers())},
                {"竞技场ID", b.arenaId},
        };
        Font bold = wb.createFont();
        bold.setBold(true);
        CellStyle boldStyle = wb.createCellStyle();
        boldStyle.setFont(bold);
        for (int i = 0; i < rows.length; i++) {
            Row r = ws.createRow(i + 2);
            Cell k = r.createCell(0);
            k.setCellValue(rows[i][0]);
            k.setCellStyle(boldStyle);
            r.createCell(1).setCellValue(rows[i][1] == null ? "" : rows[i][1]);
        }
        ws.setColumnWidth(0, 14 * 256);
        ws.setColumnWidth(1, 40 * 256);
    }

    private void sheetPlayers(final Battle b, final Tankopedia tp) {
        Sheet ws = wb.createSheet("玩家数据");
        List<Columns.Col> cols = Columns.PLAYER;
        writeHeader(ws, cols.stream().map(c -> new String[]{c.title(), String.valueOf(c.xlsx())}).toList());

        List<PlayerResult> players = Players.sorted(b.players);
        Function<Long, String> platoon = Players.platoonLabeler();
        for (PlayerResult p : players) {
            Players.enrich(p, tp);
            p.platoonLabel = platoon.apply(p.platoonId);
        }
        int rIdx = 1;
        for (PlayerResult p : players) {
            Row row = ws.createRow(rIdx++);
            CellStyle fill = p.team == 1 ? team1 : team2;
            for (int c = 0; c < cols.size(); c++) {
                Columns.Col col = cols.get(c);
                setCell(row.createCell(c), col.get().apply(p), fill, col.key());
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, players.size(), 0, cols.size() - 1));
    }

    private void sheetRaw(final Battle b) {
        Sheet ws = wb.createSheet("原始字段");
        java.util.TreeSet<Integer> fieldNums = new java.util.TreeSet<>();
        for (PlayerResult p : b.players) {
            if (p.raw != null) fieldNums.addAll(p.raw.keySet());
        }
        List<Integer> cols = new java.util.ArrayList<>(fieldNums);
        Row h = ws.createRow(0);
        cell(h, 0, "玩家", hdr);
        cell(h, 1, "账号ID", hdr);
        for (int i = 0; i < cols.size(); i++) {
            cell(h, i + 2, "#" + cols.get(i), hdr);
        }
        List<PlayerResult> players = Players.sorted(b.players);
        int rIdx = 1;
        for (PlayerResult p : players) {
            Row row = ws.createRow(rIdx++);
            row.createCell(0).setCellValue(p.nickname);
            row.createCell(1).setCellValue(p.accountId);
            for (int i = 0; i < cols.size(); i++) {
                List<Object> vals = p.raw == null ? null : p.raw.get(cols.get(i));
                if (vals == null) continue;
                StringBuilder sb = new StringBuilder();
                for (Object v : vals) {
                    if (sb.length() > 0) sb.append(", ");
                    sb.append(v instanceof byte[] ? toHex((byte[]) v) : String.valueOf(v));
                }
                row.createCell(i + 2).setCellValue(sb.toString());
            }
        }
    }

    // ---------------- 汇总 (多场) ----------------
    public static void writeAggregate(final List<Battle> battles, final List<String> sourceNames,
                                      final List<String[]> duplicates, final Tankopedia tp,
                                      final OutputStream out) throws IOException {
        Rating.compute(battles, tp);   // 基准=这批战斗
        ExcelExporter e = new ExcelExporter();
        Map<Long, Agg> agg = Aggregator.aggregate(battles, tp);
        e.sheetSummary(agg);
        e.sheetDetail(battles, tp);
        e.sheetBattleList(battles, sourceNames, duplicates);
        e.wb.write(out);
        e.wb.close();
    }

    private void sheetSummary(final Map<Long, Agg> aggMap) {
        Sheet ws = wb.createSheet("汇总");
        List<AggCol> cols = List.of(
                new AggCol("玩家", 18, false, a -> a.nickname),
                new AggCol("战队", 10, false, a -> a.clan),
                new AggCol("场次", 6, true, a -> a.battles),
                new AggCol("胜场", 6, true, a -> a.wins),
                new AggCol("胜率%", 8, true, a -> r1(a.winRate())),
                new AggCol("存活率%", 9, true, a -> r1(a.survivalRate())),
                new AggCol("场均评分", 8, true, a -> Math.round(a.avgRating())),
                new AggCol("总击杀", 7, true, a -> a.kills),
                new AggCol("场均击杀", 7, true, a -> r2(a.avg(a.kills))),
                new AggCol("总伤害", 9, true, a -> a.damage),
                new AggCol("场均伤害", 9, true, a -> r1(a.avg(a.damage))),
                new AggCol("总协助伤害", 9, true, a -> a.assisted),
                new AggCol("场均协助伤害", 9, true, a -> r1(a.avg(a.assisted))),
                new AggCol("场均损失血量", 8, true, a -> r1(a.avg(a.received))),
                new AggCol("场均格挡", 8, true, a -> r1(a.avg(a.blocked))),
                new AggCol("命中率%", 8, true, a -> r1(a.hitRate())),
                new AggCol("击穿率%", 8, true, a -> r1(a.penRate())),
                new AggCol("场均击伤", 9, true, a -> r2(a.avg(a.enemiesDamaged))),
                new AggCol("用车", 30, false, Agg::tanksStr),
                new AggCol("账号ID", 12, true, a -> a.accountId)
        );
        writeHeader(ws, cols.stream().map(c -> new String[]{c.title(), String.valueOf(c.xlsx())}).toList());
        List<Agg> rows = new java.util.ArrayList<>(aggMap.values());
        rows.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        int rIdx = 1;
        for (Agg a : rows) {
            Row row = ws.createRow(rIdx++);
            for (int c = 0; c < cols.size(); c++) {
                setCell(row.createCell(c), cols.get(c).get().apply(a), plain, c < 2 ? "nickname" : "x");
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rows.size(), 0, cols.size() - 1));
    }

    private void sheetDetail(final List<Battle> battles, final Tankopedia tp) {
        Sheet ws = wb.createSheet("明细");
        // 复用 STAT 列, 前面加场次信息, 末尾加账号
        record DCol(String title, int xlsx, String key, Function<PlayerResult, Object> get) {
        }
        List<DCol> head = List.of(
                new DCol("日期", 17, "date", p -> p.tmpDate),
                new DCol("地图", 12, "map_name", p -> p.tmpMap),
                new DCol("玩家", 16, "nickname", p -> p.nickname),
                new DCol("战队", 9, "clan", p -> p.clan),
                new DCol("车辆", 16, "tank_name", p -> p.tankName),
                new DCol("胜负", 6, "result", p -> p.tmpResult)
        );
        java.util.List<String[]> hdrSpec = new java.util.ArrayList<>();
        head.forEach(d -> hdrSpec.add(new String[]{d.title(), String.valueOf(d.xlsx())}));
        Columns.STAT.forEach(c -> hdrSpec.add(new String[]{c.title(), String.valueOf(c.xlsx())}));
        hdrSpec.add(new String[]{"账号ID", "12"});
        writeHeader(ws, hdrSpec);

        int rIdx = 1;
        for (Battle b : battles) {
            String date = fmt(b.startTime, DT_MIN);
            Integer winner = b.winnerTeam;
            for (PlayerResult p : Players.sorted(b.players)) {
                Players.enrich(p, tp);
                p.tmpDate = date;
                p.tmpMap = MapNames.cn(b.mapName);
                p.tmpResult = (winner != null && winner != 0)
                        ? (p.team == winner ? "胜" : "负") : "平";
                Row row = ws.createRow(rIdx++);
                int c = 0;
                for (DCol d : head) {
                    setCell(row.createCell(c), d.get().apply(p), plain, d.key());
                    c++;
                }
                for (Columns.Col col : Columns.STAT) {
                    setCell(row.createCell(c), col.get().apply(p), plain, col.key());
                    c++;
                }
                setCell(row.createCell(c), p.accountId, plain, "x");
            }
        }
        ws.createFreezePane(2, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rIdx - 1, 0, hdrSpec.size() - 1));
    }

    private void sheetBattleList(final List<Battle> battles, final List<String> names, final List<String[]> duplicates) {
        Sheet ws = wb.createSheet("战斗列表");
        String[][] spec = {{"序号", "6"}, {"日期", "17"}, {"地图", "12"}, {"时长", "9"},
                {"获胜队", "8"}, {"玩家数", "7"}, {"arenaUniqueId", "22"}, {"文件名", "40"}};
        writeHeader(ws, java.util.Arrays.asList(spec));
        int rIdx = 1;
        for (int i = 0; i < battles.size(); i++) {
            Battle b = battles.get(i);
            Row r = ws.createRow(rIdx++);
            r.createCell(0).setCellValue(i + 1);
            r.createCell(1).setCellValue(fmt(b.startTime, DT));
            r.createCell(2).setCellValue(MapNames.cn(b.mapName));
            r.createCell(3).setCellValue(duration(b.durationS));
            r.createCell(4).setCellValue(Players.TEAM_NAME.getOrDefault(b.winnerTeam == null ? 0 : b.winnerTeam, "平局/未知"));
            r.createCell(5).setCellValue(b.nPlayers());
            r.createCell(6).setCellValue(b.arenaId);
            r.createCell(7).setCellValue(i < names.size() ? names.get(i) : "");
        }
        if (duplicates != null && !duplicates.isEmpty()) {
            rIdx++;
            Font f = wb.createFont();
            f.setBold(true);
            f.setColor(IndexedColors.RED.getIndex());
            CellStyle s = wb.createCellStyle();
            s.setFont(f);
            Cell c = ws.createRow(rIdx++).createCell(0);
            c.setCellValue("已跳过的重复上传:");
            c.setCellStyle(s);
            for (String[] d : duplicates) {
                Row r = ws.createRow(rIdx++);
                r.createCell(1).setCellValue(d[0]);
                r.createCell(6).setCellValue(d[1]);
            }
        }
    }

    // ---------------- 共用 ----------------
    private void writeHeader(final Sheet ws, final List<String[]> titleWidth) {
        Row h = ws.createRow(0);
        for (int c = 0; c < titleWidth.size(); c++) {
            String title = titleWidth.get(c)[0];
            int width = Integer.parseInt(titleWidth.get(c)[1]);
            width = Math.max(width, Columns.displayWidth(title) + 4); // 防止被自动筛选箭头截断
            cell(h, c, title, hdr);
            ws.setColumnWidth(c, width * 256);
        }
    }

    private void setCell(final Cell cell, final Object val, final CellStyle fill, final String key) {
        if (val instanceof Number) {
            cell.setCellValue(((Number) val).doubleValue());
        } else {
            cell.setCellValue(val == null ? "" : val.toString());
        }
        // 复制填充样式 + 对齐 (POI 样式不可变, 这里用预建样式即可满足主要需求)
        cell.setCellStyle(Columns.LEFT_ALIGN.contains(key) ? leftWithFill(fill) : centerWithFill(fill));
    }

    private void cell(Row row, int c, String text, CellStyle style) {
        Cell cell = row.createCell(c);
        cell.setCellValue(text);
        cell.setCellStyle(style);
    }

    // 按需组合 "填充 + 对齐" 的样式缓存
    private final Map<String, CellStyle> styleCache = new java.util.HashMap<>();

    private CellStyle centerWithFill(final CellStyle fill) {
        return combo(fill, true);
    }

    private CellStyle leftWithFill(final CellStyle fill) {
        return combo(fill, false);
    }

    private CellStyle combo(CellStyle fill, boolean center) {
        String key = System.identityHashCode(fill) + (center ? "C" : "L");
        return styleCache.computeIfAbsent(key, k -> {
            CellStyle s = wb.createCellStyle();
            s.cloneStyleFrom(fill);
            s.setAlignment(center ? HorizontalAlignment.CENTER : HorizontalAlignment.LEFT);
            return s;
        });
    }

    private static String fmt(final Long epochSec, final DateTimeFormatter f) {
        if (epochSec == null) return "";
        return Instant.ofEpochSecond(epochSec).atZone(ZoneId.systemDefault()).format(f);
    }

    private static String duration(final Double s) {
        if (s == null) return "";
        int t = (int) Math.floor(s);
        return (t / 60) + "分" + (t % 60) + "秒";
    }

    private static double r1(final double v) {
        return Math.round(v * 10) / 10.0;
    }

    private static double r2(final double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static String toHex(final byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
