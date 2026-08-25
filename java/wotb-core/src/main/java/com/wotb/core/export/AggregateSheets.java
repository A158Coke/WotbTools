package com.wotb.core.export;

import com.wotb.core.AggregateColumns;
import com.wotb.core.Columns;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Aggregator;
import com.wotb.core.stats.PerformanceMetricsCalculator;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 多场汇总工作簿的三张表: 汇总 / 明细 / 战斗列表。 */
final class AggregateSheets {

    private AggregateSheets() {
    }

    /**
     * 汇总表 presentation spec：中文 title / xlsx width / 展示顺序。
     * key 与取值 getter 一律消费 canonical {@link AggregateColumns}（本层<b>不</b>定义
     * 业务 getter / numeric / key 宇宙）。
     */
    private record SummarySpec(String title, int width, String key) {
    }

    private static final List<SummarySpec> SUMMARY_SPECS = List.of(
            new SummarySpec("玩家", 18, "nickname"),
            new SummarySpec("战队", 10, "clan"),
            new SummarySpec("场次", 6, "battles"),
            new SummarySpec("胜场", 6, "wins"),
            new SummarySpec("胜率%", 8, "win_rate"),
            new SummarySpec("存活率%", 9, "survival_rate"),
            new SummarySpec("贡献度%", 9, "contribution"),
            new SummarySpec("KAST%", 8, "kast"),
            new SummarySpec("Impact%", 9, "impact"),
            new SummarySpec("多伤率%", 9, "multi_damage_rate"),
            new SummarySpec("互换击杀", 8, "traded_deaths"),
            new SummarySpec("平均存活时间", 12, "survival_avg"),
            new SummarySpec("总击杀", 7, "kills"),
            new SummarySpec("场均击杀", 7, "kills_avg"),
            new SummarySpec("总伤害", 9, "damage"),
            new SummarySpec("场均伤害", 9, "damage_avg"),
            new SummarySpec("总潜在伤害", 10, "potential_damage"),
            new SummarySpec("场均潜在伤害", 10, "potential_damage_avg"),
            new SummarySpec("场均补增伤害", 9, "potential_damage_supplement_avg"),
            new SummarySpec("总协助伤害", 9, "assisted"),
            new SummarySpec("场均协助伤害", 9, "assisted_avg"),
            new SummarySpec("场均损失血量", 8, "received_avg"),
            new SummarySpec("场均格挡", 8, "blocked_avg"),
            new SummarySpec("命中率%", 8, "hit_rate"),
            new SummarySpec("击穿率%", 8, "pen_rate"),
            new SummarySpec("总射击次数", 8, "shots"),
            new SummarySpec("总命中次数", 8, "hits"),
            new SummarySpec("总击穿次数", 8, "pens"),
            new SummarySpec("场均击伤", 9, "enemies_damaged_avg"),
            new SummarySpec("获取点数总计", 10, "earned_total"),
            new SummarySpec("获取点数/场", 9, "earned_avg"),
            new SummarySpec("用车", 30, "tanks"),
            new SummarySpec("账号ID", 12, "account_id")
    );

    private static final Map<String, AggregateColumns.PerfColumn> PERF_BY_KEY = new HashMap<>();
    private static final Map<String, AggregateColumns.CoreColumn> CORE_BY_KEY = new HashMap<>();

    static {
        for (final AggregateColumns.PerfColumn c : AggregateColumns.PERFORMANCE) {
            PERF_BY_KEY.put(c.key(), c);
        }
        for (final AggregateColumns.CoreColumn c : AggregateColumns.CORE) {
            CORE_BY_KEY.put(c.key(), c);
        }
    }

    static void write(final ExcelStyles styles, final List<Battle> battles, final List<String> sourceNames,
                      final List<String[]> duplicates, final Tankopedia tp) {
        write(styles, battles, sourceNames, duplicates, tp, "");
    }

    /**
     * 与 {@link #write} 相同（canonical Replay 汇总/明细/战斗列表，单一 schema 源）；
     * {@code sheetPrefix} 供 League 批量工作簿区分（如 "Replay "），避免与 League 专属表同名。
     */
    static void write(final ExcelStyles styles, final List<Battle> battles, final List<String> sourceNames,
                      final List<String[]> duplicates, final Tankopedia tp, final String sheetPrefix) {
        final Map<Long, Agg> agg = Aggregator.aggregate(battles, tp);
        final Map<Long, PerformanceMetricsCalculator.Row> perfById = new HashMap<>();
        for (final PerformanceMetricsCalculator.Row row : PerformanceMetricsCalculator.compute(battles)) {
            perfById.put(row.accountId, row);
        }
        summary(styles, agg, perfById, sheetPrefix);
        detail(styles, battles, sourceNames, tp, sheetPrefix);
        battleList(styles, battles, sourceNames, duplicates, sheetPrefix);
    }

    private static void summary(final ExcelStyles styles, final Map<Long, Agg> aggMap,
                                final Map<Long, PerformanceMetricsCalculator.Row> perfById,
                                final String sheetPrefix) {
        final Sheet ws = styles.workbook().createSheet(sheetPrefix + "汇总");
        // 与 API Mapper.toAggregate 同一 canonical 契约（AggregateColumns getter 单一事实源）：
        //   contribution/kast/多伤率 依赖 HP（hpEligible=false 时 unavailable → null = Excel 空单元格）
        //   impact/tradedDeaths 不依赖 HP（仅要求该账号存在 performance row）
        styles.writeHeader(ws, SUMMARY_SPECS.stream()
                .map(s -> new String[]{s.title(), String.valueOf(s.width())}).toList());
        final List<Agg> rows = new ArrayList<>(aggMap.values());
        rows.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        int rIdx = 1;
        for (final Agg a : rows) {
            final Row row = ws.createRow(rIdx++);
            for (int c = 0; c < SUMMARY_SPECS.size(); c++) {
                styles.setCell(row.createCell(c), summaryValue(SUMMARY_SPECS.get(c), a, perfById),
                        styles.plain(), c < 2 ? "nickname" : "x");
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rows.size(), 0, SUMMARY_SPECS.size() - 1));
    }

    /** 汇总单元格取值：canonical getter 单一来源；仅「平均存活时间」做 Excel duration 展示格式化。 */
    private static Object summaryValue(final SummarySpec spec, final Agg a,
                                       final Map<Long, PerformanceMetricsCalculator.Row> perfById) {
        if (spec.key().equals("survival_avg")) {
            return ExcelStyles.duration((Double) CORE_BY_KEY.get(spec.key()).get().apply(a));
        }
        final AggregateColumns.PerfColumn perf = PERF_BY_KEY.get(spec.key());
        if (perf != null) {
            final PerformanceMetricsCalculator.Row row = perfById.get(a.accountId);
            return row == null ? null : perf.get().apply(row);
        }
        return CORE_BY_KEY.get(spec.key()).get().apply(a);
    }

    /**
     * Replay 明细：battle context（文件名 / 竞技场ID / 日期 / 地图 / 胜负）+
     * 完整 canonical {@link Columns#PLAYER}（玩家/战队/车辆/等级/类型/国家/炮伤/单场 stats/
     * 被命中/被击穿/击伤/排/军阶/车辆ID/账号ID——单一 schema 源，不复制字段列表）。
     */
    private static void detail(final ExcelStyles styles, final List<Battle> battles, final List<String> sourceNames,
                               final Tankopedia tp, final String sheetPrefix) {
        final Sheet ws = styles.workbook().createSheet(sheetPrefix + "明细");
        record DCol(String title, int xlsx, String key, java.util.function.Function<PlayerResult, Object> get) {
        }
        final List<String[]> hdrSpec = new ArrayList<>();
        hdrSpec.add(new String[]{"文件名", "40"});
        hdrSpec.add(new String[]{"竞技场ID", "22"});
        hdrSpec.add(new String[]{"日期", "17"});
        hdrSpec.add(new String[]{"地图", "12"});
        hdrSpec.add(new String[]{"胜负", "6"});
        Columns.PLAYER.forEach(c -> hdrSpec.add(new String[]{c.title(), String.valueOf(c.xlsx())}));
        styles.writeHeader(ws, hdrSpec);

        final java.util.function.Function<Long, String> platoon = Players.platoonLabeler();
        int rIdx = 1;
        for (int i = 0; i < battles.size(); i++) {
            final Battle b = battles.get(i);
            final String date = ExcelStyles.fmt(b.startTime, ExcelStyles.DT_MIN);
            final Integer winner = b.winnerTeam;
            final String sourceName = i < sourceNames.size() ? sourceNames.get(i) : "";
            final String mapName = MapNames.cn(b.mapName);
            final List<DCol> head = List.of(
                    new DCol("文件名", 40, "nickname", p -> sourceName),
                    new DCol("竞技场ID", 22, "x", p -> b.arenaId),
                    new DCol("日期", 17, "date", p -> date),
                    new DCol("地图", 12, "map_name", p -> mapName),
                    new DCol("胜负", 6, "x", p -> resultOf(winner, p.team))
            );
            for (final PlayerResult p : Players.sorted(b.players)) {
                Players.enrich(p, tp);
                p.platoonLabel = platoon.apply(p.platoonId);
                final Row row = ws.createRow(rIdx++);
                int c = 0;
                for (final DCol d : head) {
                    styles.setCell(row.createCell(c), d.get().apply(p), styles.plain(), d.key());
                    c++;
                }
                for (final Columns.Column column : Columns.PLAYER) {
                    styles.setCell(row.createCell(c), SingleBattleSheets.playerColumnValue(column, p),
                            styles.plain(), column.key());
                    c++;
                }
            }
        }
        ws.createFreezePane(2, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rIdx - 1, 0, hdrSpec.size() - 1));
    }

    private static String resultOf(final Integer winner, final int team) {
        if (winner == null || winner == 0) {
            return "平";
        }
        return team == winner ? "胜" : "负";
    }

    private static void battleList(final ExcelStyles styles, final List<Battle> battles,
                                   final List<String> names, final List<String[]> duplicates,
                                   final String sheetPrefix) {
        final Sheet ws = styles.workbook().createSheet(sheetPrefix + "战斗列表");
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
