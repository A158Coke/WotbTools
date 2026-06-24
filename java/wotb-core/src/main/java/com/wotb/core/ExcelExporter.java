package com.wotb.core;

import com.wotb.core.model.Battle;

import java.io.IOException;
import java.io.OutputStream;
import java.util.List;

/**
 * 导出 xlsx 的门面 (POI): 单场 / 多场汇总。
 * 仅做编排; 渲染底座在 {@link ExcelStyles}, 各表结构在 {@link SingleBattleSheets} / {@link AggregateSheets}。
 */
public final class ExcelExporter {

    private ExcelExporter() {
    }

    /** 单场工作簿: 战斗信息 / 玩家数据 / 原始字段。 */
    public static void writeSingle(final Battle battle, final Tankopedia tp, final OutputStream out) throws IOException {
        Rating.compute(List.of(battle), tp);   // 基准=该场内
        final ExcelStyles styles = new ExcelStyles();
        SingleBattleSheets.write(styles, battle, tp);
        styles.writeTo(out);
    }

    /** 多场汇总工作簿 (去重后): 汇总 / 明细 / 战斗列表。 */
    public static void writeAggregate(final List<Battle> battles, final List<String> sourceNames,
                                      final List<String[]> duplicates, final Tankopedia tp,
                                      final OutputStream out) throws IOException {
        Rating.compute(battles, tp);   // 基准=这批战斗
        final ExcelStyles styles = new ExcelStyles();
        AggregateSheets.write(styles, battles, sourceNames, duplicates, tp);
        styles.writeTo(out);
    }
}
