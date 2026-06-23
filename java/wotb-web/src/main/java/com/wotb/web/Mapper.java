package com.wotb.web;

import com.wotb.core.Columns;
import com.wotb.core.Players;
import com.wotb.core.Tankopedia;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.web.dto.AggRow;
import com.wotb.web.dto.BattleDto;
import com.wotb.web.dto.ColumnDef;
import com.wotb.web.dto.PlayerRow;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** model -> 前端 DTO (复用 core 的列定义, 保证与 Excel/桌面一致)。 */
public final class Mapper {

    private Mapper() {
    }

    /** 玩家表列定义 (纯数据: key + 是否数值; 中文名由前端映射)。 */
    public static List<ColumnDef> playerColumns() {
        List<ColumnDef> out = new ArrayList<>();
        for (Columns.Col c : Columns.PLAYER) {
            out.add(new ColumnDef(c.key(), c.num()));
        }
        return out;
    }

    /** 汇总表列定义 (key + 是否数值 + 取值函数; 中文名由前端/导出层各自映射)。 */
    record AggCol(String key, boolean num, Function<Agg, Object> get) {
    }

    static final List<AggCol> AGG_COLS = List.of(
            new AggCol("nickname", false, a -> a.nickname),
            new AggCol("clan", false, a -> a.clan),
            new AggCol("battles", true, a -> a.battles),
            new AggCol("wins", true, a -> a.wins),
            new AggCol("win_rate", true, a -> r1(a.winRate())),
            new AggCol("survival_rate", true, a -> r1(a.survivalRate())),
            new AggCol("rating_avg", true, a -> Math.round(a.avgRating())),
            new AggCol("kills", true, a -> a.kills),
            new AggCol("kills_avg", true, a -> r2(a.avg(a.kills))),
            new AggCol("damage", true, a -> a.damage),
            new AggCol("damage_avg", true, a -> r1(a.avg(a.damage))),
            new AggCol("assisted", true, a -> a.assisted),
            new AggCol("assisted_avg", true, a -> r1(a.avg(a.assisted))),
            new AggCol("received_avg", true, a -> r1(a.avg(a.received))),
            new AggCol("blocked_avg", true, a -> r1(a.avg(a.blocked))),
            new AggCol("hit_rate", true, a -> r1(a.hitRate())),
            new AggCol("pen_rate", true, a -> r1(a.penRate())),
            new AggCol("enemies_damaged_avg", true, a -> r2(a.avg(a.enemiesDamaged))),
            new AggCol("tanks", false, Agg::tanksStr),
            new AggCol("account_id", true, a -> a.accountId)
    );

    public static List<ColumnDef> aggregateColumns() {
        List<ColumnDef> out = new ArrayList<>();
        for (AggCol c : AGG_COLS) {
            out.add(new ColumnDef(c.key(), c.num()));
        }
        return out;
    }

    public static BattleDto toBattle(final Battle b, final String sourceName, final Tankopedia tp) {
        Function<Long, String> platoon = Players.platoonLabeler();
        List<PlayerRow> rows = new ArrayList<>();
        for (PlayerResult p : Players.sorted(b.players)) {
            Players.enrich(p, tp);
            p.platoonLabel = platoon.apply(p.platoonId);
            Map<String, Object> cells = new LinkedHashMap<>();
            for (Columns.Col c : Columns.PLAYER) {
                cells.put(c.key(), c.get().apply(p));
            }
            rows.add(new PlayerRow(cells, p.team));
        }
        return new BattleDto(b.arenaId, b.mapName, b.version, b.durationS,
                b.startTime, b.winnerTeam, sourceName, rows);
    }

    public static List<AggRow> toAggregate(final Map<Long, Agg> aggMap) {
        List<Agg> list = new ArrayList<>(aggMap.values());
        list.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        List<AggRow> out = new ArrayList<>();
        for (Agg a : list) {
            Map<String, Object> cells = new LinkedHashMap<>();
            for (AggCol c : AGG_COLS) {
                cells.put(c.key(), c.get().apply(a));
            }
            out.add(new AggRow(cells, a.team));
        }
        return out;
    }

    private static double r1(final double v) {
        return Math.round(v * 10) / 10.0;
    }

    private static double r2(final double v) {
        return Math.round(v * 100) / 100.0;
    }
}
