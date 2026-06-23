package com.wotb.web;

import com.wotb.core.Aggregator;
import com.wotb.core.Columns;
import com.wotb.core.Players;
import com.wotb.core.Tankopedia;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** model -> 前端 DTO (复用 core 的列定义, 保证与 Excel/桌面一致)。 */
final class Mapper {

    private Mapper() {
    }

    /** 玩家表列定义。 */
    static List<Dtos.ColumnDef> playerColumns() {
        List<Dtos.ColumnDef> out = new ArrayList<>();
        for (Columns.Col c : Columns.PLAYER) {
            out.add(new Dtos.ColumnDef(c.title(), c.key(), c.num()));
        }
        return out;
    }

    /** 汇总表列定义 (与 ExcelExporter 的「汇总」表一致)。 */
    record AggCol(String title, String key, boolean num, Function<Aggregator.Agg, Object> get) {
    }

    static final List<AggCol> AGG_COLS = List.of(
            new AggCol("玩家", "nickname", false, a -> a.nickname),
            new AggCol("战队", "clan", false, a -> a.clan),
            new AggCol("场次", "battles", true, a -> a.battles),
            new AggCol("胜场", "wins", true, a -> a.wins),
            new AggCol("胜率%", "win_rate", true, a -> r1(a.winRate())),
            new AggCol("存活率%", "survival_rate", true, a -> r1(a.survivalRate())),
            new AggCol("总击杀", "kills", true, a -> a.kills),
            new AggCol("均击杀", "kills_avg", true, a -> r2(a.avg(a.kills))),
            new AggCol("总伤害", "damage", true, a -> a.damage),
            new AggCol("均伤害", "damage_avg", true, a -> r1(a.avg(a.damage))),
            new AggCol("总辅助伤害", "assisted", true, a -> a.assisted),
            new AggCol("均辅助伤害", "assisted_avg", true, a -> r1(a.avg(a.assisted))),
            new AggCol("均承受伤害", "received_avg", true, a -> r1(a.avg(a.received))),
            new AggCol("均抵挡伤害", "blocked_avg", true, a -> r1(a.avg(a.blocked))),
            new AggCol("命中率%", "hit_rate", true, a -> r1(a.hitRate())),
            new AggCol("击穿率%", "pen_rate", true, a -> r1(a.penRate())),
            new AggCol("均击伤敌数", "enemies_damaged_avg", true, a -> r2(a.avg(a.enemiesDamaged))),
            new AggCol("用车", "tanks", false, Aggregator.Agg::tanksStr),
            new AggCol("账号ID", "account_id", true, a -> a.accountId)
    );

    static List<Dtos.ColumnDef> aggregateColumns() {
        List<Dtos.ColumnDef> out = new ArrayList<>();
        for (AggCol c : AGG_COLS) {
            out.add(new Dtos.ColumnDef(c.title(), c.key(), c.num()));
        }
        return out;
    }

    static Dtos.BattleDto toBattle(Battle b, String sourceName, Tankopedia tp) {
        Function<Long, String> platoon = Players.platoonLabeler();
        List<Dtos.PlayerRow> rows = new ArrayList<>();
        for (PlayerResult p : Players.sorted(b.players)) {
            Players.enrich(p, tp);
            p.platoonLabel = platoon.apply(p.platoonId);
            Map<String, Object> cells = new LinkedHashMap<>();
            for (Columns.Col c : Columns.PLAYER) {
                cells.put(c.key(), c.get().apply(p));
            }
            rows.add(new Dtos.PlayerRow(cells, p.team));
        }
        return new Dtos.BattleDto(b.arenaId, b.mapName, b.version, b.durationS,
                b.startTime, b.winnerTeam, sourceName, rows);
    }

    static List<Dtos.AggRow> toAggregate(Map<Long, Aggregator.Agg> aggMap) {
        List<Aggregator.Agg> list = new ArrayList<>(aggMap.values());
        list.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        List<Dtos.AggRow> out = new ArrayList<>();
        for (Aggregator.Agg a : list) {
            Map<String, Object> cells = new LinkedHashMap<>();
            for (AggCol c : AGG_COLS) {
                cells.put(c.key(), c.get().apply(a));
            }
            out.add(new Dtos.AggRow(cells));
        }
        return out;
    }

    private static double r1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    private static double r2(double v) {
        return Math.round(v * 100) / 100.0;
    }
}
