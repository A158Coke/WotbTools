package com.wotb.core.export;

import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.Columns;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Aggregator;
import com.wotb.core.stats.Players;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellRangeAddress;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** 多场汇总工作簿的三张表: 汇总 / 明细 / 战斗列表。 */
final class AggregateSheets {

    /** 汇总表的一列。 */
    private record AggregateColumn(String title, int xlsx, boolean num, Function<Agg, Object> get) {
    }

    private AggregateSheets() {
    }

    static void write(final ExcelStyles styles, final List<Battle> battles, final List<String> sourceNames,
                      final List<String[]> duplicates, final Tankopedia tp) {
        final Map<Long, Agg> agg = Aggregator.aggregate(battles, tp);
        summary(styles, agg);
        detail(styles, battles, tp);
        battleList(styles, battles, sourceNames, duplicates);
    }

    private static void summary(final ExcelStyles styles, final Map<Long, Agg> aggMap) {
        final Sheet ws = styles.workbook().createSheet("汇总");
        final List<AggregateColumn> cols = List.of(
                new AggregateColumn("玩家", 18, false, a -> a.nickname),
                new AggregateColumn("战队", 10, false, a -> a.clan),
                new AggregateColumn("场次", 6, true, a -> a.battles),
                new AggregateColumn("胜场", 6, true, a -> a.wins),
                new AggregateColumn("胜率%", 8, true, a -> ExcelStyles.r1(a.winRate())),
                new AggregateColumn("存活率%", 9, true, a -> ExcelStyles.r1(a.survivalRate())),
                new AggregateColumn("平均存活时间", 12, false, a -> ExcelStyles.duration(a.avg(a.survivalSum))),
                new AggregateColumn("场均评分", 8, true, a -> Math.round(a.avgRating())),
                new AggregateColumn("总击杀", 7, true, a -> a.kills),
                new AggregateColumn("场均击杀", 7, true, a -> ExcelStyles.r2(a.avg(a.kills))),
                new AggregateColumn("总伤害", 9, true, a -> a.damage),
                new AggregateColumn("场均伤害", 9, true, a -> ExcelStyles.r1(a.avg(a.damage))),
                new AggregateColumn("总协助伤害", 9, true, a -> a.assisted),
                new AggregateColumn("场均协助伤害", 9, true, a -> ExcelStyles.r1(a.avg(a.assisted))),
                new AggregateColumn("场均损失血量", 8, true, a -> ExcelStyles.r1(a.avg(a.received))),
                new AggregateColumn("场均格挡", 8, true, a -> ExcelStyles.r1(a.avg(a.blocked))),
                new AggregateColumn("命中率%", 8, true, a -> ExcelStyles.r1(a.hitRate())),
                new AggregateColumn("击穿率%", 8, true, a -> ExcelStyles.r1(a.penRate())),
                new AggregateColumn("总射击次数", 8, true, a -> a.shots),
                new AggregateColumn("总命中次数", 8, true, a -> a.hits),
                new AggregateColumn("总击穿次数", 8, true, a -> a.pens),
                new AggregateColumn("场均击伤", 9, true, a -> ExcelStyles.r2(a.avg(a.enemiesDamaged))),
                new AggregateColumn("用车", 30, false, Agg::tanksStr),
                new AggregateColumn("账号ID", 12, true, a -> a.accountId)
        );
        styles.writeHeader(ws, cols.stream().map(c -> new String[]{c.title(), String.valueOf(c.xlsx())}).toList());
        final List<Agg> rows = new ArrayList<>(aggMap.values());
        rows.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        int rIdx = 1;
        for (final Agg a : rows) {
            final Row row = ws.createRow(rIdx++);
            for (int c = 0; c < cols.size(); c++) {
                styles.setCell(row.createCell(c), cols.get(c).get().apply(a), styles.plain(), c < 2 ? "nickname" : "x");
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rows.size(), 0, cols.size() - 1));
    }

    private static void detail(final ExcelStyles styles, final List<Battle> battles, final Tankopedia tp) {
        final Sheet ws = styles.workbook().createSheet("明细");
        // 复用 STAT 列, 前面加场次信息, 末尾加账号
        record DCol(String title, int xlsx, String key, Function<PlayerResult, Object> get) {
        }
        final List<DCol> head = List.of(
                new DCol("日期", 17, "date", p -> p.tmpDate),
                new DCol("地图", 12, "map_name", p -> p.tmpMap),
                new DCol("玩家", 16, "nickname", p -> p.nickname),
                new DCol("战队", 9, "clan", p -> p.clan),
                new DCol("车辆", 16, "tank_name", p -> p.tankName),
                new DCol("胜负", 6, "result", p -> p.tmpResult)
        );
        final List<String[]> hdrSpec = new ArrayList<>();
        head.forEach(d -> hdrSpec.add(new String[]{d.title(), String.valueOf(d.xlsx())}));
        Columns.STAT.forEach(c -> hdrSpec.add(new String[]{c.title(), String.valueOf(c.xlsx())}));
        hdrSpec.add(new String[]{"账号ID", "12"});
        styles.writeHeader(ws, hdrSpec);

        int rIdx = 1;
        for (final Battle b : battles) {
            final String date = ExcelStyles.fmt(b.startTime, ExcelStyles.DT_MIN);
            final Integer winner = b.winnerTeam;
            for (final PlayerResult p : Players.sorted(b.players)) {
                Players.enrich(p, tp);
                p.tmpDate = date;
                p.tmpMap = MapNames.cn(b.mapName);
                p.tmpResult = (winner != null && winner != 0)
                        ? (p.team == winner ? "胜" : "负") : "平";
                final Row row = ws.createRow(rIdx++);
                int c = 0;
                for (final DCol d : head) {
                    styles.setCell(row.createCell(c), d.get().apply(p), styles.plain(), d.key());
                    c++;
                }
                for (final Columns.Column column : Columns.STAT) {
                    final Object val = "survival_time".equals(column.key())
                            ? ExcelStyles.duration((Double) column.get().apply(p))
                            : column.get().apply(p);
                    styles.setCell(row.createCell(c), val, styles.plain(), column.key());
                    c++;
                }
                styles.setCell(row.createCell(c), p.accountId, styles.plain(), "x");
            }
        }
        ws.createFreezePane(2, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rIdx - 1, 0, hdrSpec.size() - 1));
    }

    private static void battleList(final ExcelStyles styles, final List<Battle> battles,
                                   final List<String> names, final List<String[]> duplicates) {
        final Sheet ws = styles.workbook().createSheet("战斗列表");
        final String[][] spec = {{"序号", "6"}, {"日期", "17"}, {"地图", "12"}, {"时长", "9"},
                {"获胜队", "8"}, {"玩家数", "7"}, {"arenaUniqueId", "22"}, {"文件名", "40"}};
        styles.writeHeader(ws, Arrays.asList(spec));
        int rIdx = 1;
        for (int i = 0; i < battles.size(); i++) {
            final Battle b = battles.get(i);
            final Row r = ws.createRow(rIdx++);
            r.createCell(0).setCellValue(i + 1);
            r.createCell(1).setCellValue(ExcelStyles.fmt(b.startTime, ExcelStyles.DT));
            r.createCell(2).setCellValue(MapNames.cn(b.mapName));
            r.createCell(3).setCellValue(ExcelStyles.duration(b.durationS));
            r.createCell(4).setCellValue(Players.TEAM_NAME.getOrDefault(b.winnerTeam == null ? 0 : b.winnerTeam, "平局/未知"));
            r.createCell(5).setCellValue(b.nPlayers());
            r.createCell(6).setCellValue(b.arenaId);
            r.createCell(7).setCellValue(i < names.size() ? names.get(i) : "");
        }
        if (duplicates != null && !duplicates.isEmpty()) {
            rIdx++;
            final Workbook wb = styles.workbook();
            final Font f = wb.createFont();
            f.setBold(true);
            f.setColor(IndexedColors.RED.getIndex());
            final CellStyle s = wb.createCellStyle();
            s.setFont(f);
            final Cell c = ws.createRow(rIdx++).createCell(0);
            c.setCellValue("已跳过的重复上传:");
            c.setCellStyle(s);
            for (final String[] d : duplicates) {
                final Row r = ws.createRow(rIdx++);
                r.createCell(1).setCellValue(d[0]);
                r.createCell(6).setCellValue(d[1]);
            }
        }
    }
}
