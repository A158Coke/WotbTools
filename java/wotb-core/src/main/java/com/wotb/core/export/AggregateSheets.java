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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/** 多场汇总工作簿的三张表: 汇总 / 明细 / 战斗列表。 */
final class AggregateSheets {

    private AggregateSheets() {
    }

    /** 汇总表 presentation 元数据：中文 title + xlsx width（key 由 canonical 列驱动，不允许自建 key 宇宙）。 */
    private record SummaryPresentation(String title, int width) {
    }

    private static final Map<String, SummaryPresentation> SUMMARY_PRESENTATION = Map.ofEntries(
            Map.entry("nickname", new SummaryPresentation("玩家", 18)),
            Map.entry("clan", new SummaryPresentation("战队", 10)),
            Map.entry("battles", new SummaryPresentation("场次", 6)),
            Map.entry("wins", new SummaryPresentation("胜场", 6)),
            Map.entry("win_rate", new SummaryPresentation("胜率%", 8)),
            Map.entry("survival_rate", new SummaryPresentation("存活率%", 9)),
            Map.entry("survival_avg", new SummaryPresentation("平均存活时间", 12)),
            Map.entry("kills", new SummaryPresentation("总击杀", 7)),
            Map.entry("kills_avg", new SummaryPresentation("场均击杀", 7)),
            Map.entry("damage", new SummaryPresentation("总伤害", 9)),
            Map.entry("damage_avg", new SummaryPresentation("场均伤害", 9)),
            Map.entry("potential_damage", new SummaryPresentation("总潜在伤害", 10)),
            Map.entry("potential_damage_avg", new SummaryPresentation("场均潜在伤害", 10)),
            Map.entry("potential_damage_supplement_avg", new SummaryPresentation("场均补增伤害", 9)),
            Map.entry("assisted", new SummaryPresentation("总协助伤害", 9)),
            Map.entry("assisted_avg", new SummaryPresentation("场均协助伤害", 9)),
            Map.entry("received_avg", new SummaryPresentation("场均损失血量", 8)),
            Map.entry("blocked_avg", new SummaryPresentation("场均格挡", 8)),
            Map.entry("hit_rate", new SummaryPresentation("命中率%", 8)),
            Map.entry("pen_rate", new SummaryPresentation("击穿率%", 8)),
            Map.entry("shots", new SummaryPresentation("总射击次数", 8)),
            Map.entry("hits", new SummaryPresentation("总命中次数", 8)),
            Map.entry("pens", new SummaryPresentation("总击穿次数", 8)),
            Map.entry("enemies_damaged_avg", new SummaryPresentation("场均击伤", 9)),
            Map.entry("tanks", new SummaryPresentation("用车", 30)),
            Map.entry("account_id", new SummaryPresentation("账号ID", 12)),
            Map.entry("earned_total", new SummaryPresentation("获取点数总计", 10)),
            Map.entry("earned_avg", new SummaryPresentation("获取点数/场", 9)),
            Map.entry("contribution", new SummaryPresentation("贡献度%", 9)),
            Map.entry("kast", new SummaryPresentation("KAST%", 8)),
            Map.entry("impact", new SummaryPresentation("Impact%", 9)),
            Map.entry("multi_damage_rate", new SummaryPresentation("多伤率%", 9)),
            Map.entry("traded_deaths", new SummaryPresentation("互换击杀", 8))
    );

    /** 表现派生列 key 集合（canonical 成员资格单一来源）。 */
    private static final Set<String> PERF_KEYS;

    /** 汇总列集合 = canonical {@link AggregateColumns#CORE} + {@link AggregateColumns#PERFORMANCE}
     * （Excel 与 API 同一 canonical 列宇宙；presentation 只提供 title/width）。 */
    private static final List<String> SUMMARY_KEYS;

    static {
        final List<String> keys = new ArrayList<>();
        final Set<String> perfKeys = new HashSet<>();
        for (final AggregateColumns.CoreColumn c : AggregateColumns.CORE) {
            keys.add(c.key());
        }
        for (final AggregateColumns.PerfColumn c : AggregateColumns.PERFORMANCE) {
            keys.add(c.key());
            perfKeys.add(c.key());
        }
        // fail fast：canonical key 必须全部有 presentation metadata；
        // 缺任何一个（新增字段忘加 title/width）在类加载即失败，绝不静默缺列。
        for (final String key : keys) {
            if (!SUMMARY_PRESENTATION.containsKey(key)) {
                throw new IllegalStateException(
                        "aggregate summary presentation metadata missing for canonical key: " + key);
            }
        }
        SUMMARY_KEYS = List.copyOf(keys);
        PERF_KEYS = Set.copyOf(perfKeys);
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
        styles.writeHeader(ws, SUMMARY_KEYS.stream()
                .map(k -> new String[]{SUMMARY_PRESENTATION.get(k).title(),
                        String.valueOf(SUMMARY_PRESENTATION.get(k).width())}).toList());
        final List<Agg> rows = new ArrayList<>(aggMap.values());
        rows.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        int rIdx = 1;
        for (final Agg a : rows) {
            final Row row = ws.createRow(rIdx++);
            for (int c = 0; c < SUMMARY_KEYS.size(); c++) {
                styles.setCell(row.createCell(c), summaryValue(SUMMARY_KEYS.get(c), a, perfById),
                        styles.plain(), c < 2 ? "nickname" : "x");
            }
        }
        ws.createFreezePane(1, 1);
        ws.setAutoFilter(new CellRangeAddress(0, rows.size(), 0, SUMMARY_KEYS.size() - 1));
    }

    /** 汇总单元格取值：canonical getter 单一来源；仅「平均存活时间」做 Excel duration 展示格式化。 */
    private static Object summaryValue(final String key, final Agg a,
                                       final Map<Long, PerformanceMetricsCalculator.Row> perfById) {
        if (key.equals("survival_avg")) {
            return ExcelStyles.duration((Double) AggregateColumns.core(key).get().apply(a));
        }
        if (PERF_KEYS.contains(key)) {
            final PerformanceMetricsCalculator.Row row = perfById.get(a.accountId);
            return row == null ? null : AggregateColumns.perf(key).get().apply(row);
        }
        return AggregateColumns.core(key).get().apply(a);
    }

    /**
     * Replay 明细：battle context（文件名 / 竞技场ID / 日期 / 地图 / 胜负）+
     * 完整 canonical {@link Columns#PLAYER}（玩家/战队/车辆/等级/类型/国家/炮伤/单场 stats/
     * 被命中/被击穿/击伤/排/军阶/车辆ID/账号ID——单一 schema 源，不复制字段列表）。
     *
     * <p>排标签（{@link Players#platoonLabeler}）按单场 Battle 独立：platoonId → A/B/C
     * 映射只在该场有效，不同 replay 的排号重新从 A 开始（排号不是跨场身份）。</p>
     */
    private static void detail(final ExcelStyles styles, final List<Battle> battles, final List<String> sourceNames,
                               final Tankopedia tp, final String sheetPrefix) {
        final Sheet ws = styles.workbook().createSheet(sheetPrefix + "明细");
        record DCol(String title, int xlsx, String key, Function<PlayerResult, Object> get) {
        }
        final List<String[]> hdrSpec = new ArrayList<>();
        hdrSpec.add(new String[]{"文件名", "40"});
        hdrSpec.add(new String[]{"竞技场ID", "22"});
        hdrSpec.add(new String[]{"日期", "17"});
        hdrSpec.add(new String[]{"地图", "12"});
        hdrSpec.add(new String[]{"胜负", "6"});
        Columns.PLAYER.forEach(c -> hdrSpec.add(new String[]{c.title(), String.valueOf(c.xlsx())}));
        styles.writeHeader(ws, hdrSpec);

        int rIdx = 1;
        for (int i = 0; i < battles.size(); i++) {
            final Battle b = battles.get(i);
            final String date = ExcelStyles.fmt(b.startTime, ExcelStyles.DT_MIN);
            final Integer winner = b.winnerTeam;
            final String sourceName = i < sourceNames.size() ? sourceNames.get(i) : "";
            final String mapName = MapNames.cn(b.mapName);
            // 每场独立 platoon labeler：跨 battle 不共享 platoonId → 字母映射
            final Function<Long, String> platoon = Players.platoonLabeler();
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
