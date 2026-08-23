package com.wotb.core.export;

import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.model.Battle;
import com.wotb.core.ref.Tankopedia;

import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;

/**
 * 导出 xlsx 的门面 (POI): 单场 / 多场汇总 / League Rating 单场与批量。
 * 仅做编排; 渲染底座在 {@link ExcelStyles}, 各表结构在 {@link SingleBattleSheets} /
 * {@link AggregateSheets} / {@link LeagueSingleSheets} / {@link LeagueAggregateSheets}。
 */
public final class ExcelExporter {

    private ExcelExporter() {
    }

    /** 单场工作簿: 战斗信息 / 玩家数据 / 原始字段。 */
    public static void writeSingle(final Battle battle, final Tankopedia tp, final OutputStream out) throws IOException {
        final ExcelStyles styles = new ExcelStyles();
        SingleBattleSheets.write(styles, battle, tp);
        styles.writeTo(out);
    }

    /** 多场汇总工作簿 (去重后): 汇总 / 明细 / 战斗列表。 */
    public static void writeAggregate(final List<Battle> battles, final List<String> sourceNames,
                                      final List<String[]> duplicates, final Tankopedia tp,
                                      final OutputStream out) throws IOException {
        final ExcelStyles styles = new ExcelStyles();
        AggregateSheets.write(styles, battles, sourceNames, duplicates, tp);
        styles.writeTo(out);
    }

    /** League Rating 单场工作簿：玩家数据（维度分/满分/百分比）/ 战斗信息（战队 Rating + MVP）/ 原始字段。 */
    public static void writeSingleLeague(final Battle battle, final LeagueRatingResult result,
                                         final Tankopedia tp, final OutputStream out) throws IOException {
        writeSingleLeague(battle, result, tp, Map.of(), out);
    }

    /** League Rating 单场工作簿（带战队名称覆盖：{arenaId}:{team} → 显示名，仅本次调用内使用）。 */
    public static void writeSingleLeague(final Battle battle, final LeagueRatingResult result,
                                         final Tankopedia tp, final Map<String, String> teamNameOverrides,
                                         final OutputStream out) throws IOException {
        final ExcelStyles styles = new ExcelStyles();
        new LeagueSingleSheets(teamNameOverrides).write(styles, battle, result, tp);
        styles.writeTo(out);
    }

    /** League Rating 批量工作簿：选手汇总 / 战队汇总 / 每场明细 / 战斗列表。 */
    public static void writeAggregateLeague(final List<Battle> battles, final List<String> sourceNames,
                                            final List<String[]> duplicates, final LeagueRatingBatch batch,
                                            final Tankopedia tp, final OutputStream out) throws IOException {
        writeAggregateLeague(battles, sourceNames, duplicates, batch, tp, Map.of(), out);
    }

    /** League Rating 批量工作簿（带战队名称覆盖，仅本次调用内使用）。 */
    public static void writeAggregateLeague(final List<Battle> battles, final List<String> sourceNames,
                                            final List<String[]> duplicates, final LeagueRatingBatch batch,
                                            final Tankopedia tp, final Map<String, String> teamNameOverrides,
                                            final OutputStream out) throws IOException {
        final ExcelStyles styles = new ExcelStyles();
        new LeagueAggregateSheets(teamNameOverrides).write(styles, battles, sourceNames, duplicates, batch, tp);
        styles.writeTo(out);
    }
}
