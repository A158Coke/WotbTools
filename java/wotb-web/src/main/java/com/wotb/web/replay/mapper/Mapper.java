package com.wotb.web.replay.mapper;

import com.wotb.core.Columns;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import com.wotb.core.stats.Players;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.web.replay.dto.AggRow;
import com.wotb.web.replay.dto.BattleDto;
import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.dto.PlayerRow;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** model -> 前端 DTO（复用 core 列 key；展示值转换为稳定英文码）。 */
public final class Mapper {

    private Mapper() {
    }

    /** 玩家表列定义 (纯数据: key + 是否数值; 中文名由前端映射)。 */
    public static List<ColumnDef> playerColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        for (final Columns.Column c : Columns.PLAYER) {
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
            new AggCol("survival_avg", true, a -> a.avg(a.survivalSum)),
            new AggCol("kills", true, a -> a.kills),
            new AggCol("kills_avg", true, a -> r2(a.avg(a.kills))),
            new AggCol("damage", true, a -> a.damage),
            new AggCol("damage_avg", true, a -> r1(a.avg(a.damage))),
            new AggCol("potential_damage", true, a -> a.potentialDamage),
            new AggCol("potential_damage_avg", true, a -> r1(a.avg(a.potentialDamage))),
            new AggCol("potential_damage_supplement_avg", true, a -> r1(a.avg(a.potentialDamageSupplement))),
            new AggCol("assisted", true, a -> a.assisted),
            new AggCol("assisted_avg", true, a -> r1(a.avg(a.assisted))),
            new AggCol("received_avg", true, a -> r1(a.avg(a.received))),
            new AggCol("blocked_avg", true, a -> r1(a.avg(a.blocked))),
            new AggCol("hit_rate", true, a -> r1(a.hitRate())),
            new AggCol("pen_rate", true, a -> r1(a.penRate())),
            new AggCol("shots", true, a -> a.shots),
            new AggCol("hits", true, a -> a.hits),
            new AggCol("pens", true, a -> a.pens),
            new AggCol("enemies_damaged_avg", true, a -> r2(a.avg(a.enemiesDamaged))),
            new AggCol("tanks", false, Agg::tanksStr),
            new AggCol("account_id", true, a -> a.accountId)
    );

    /** 汇总表追加的跨场表现派生列（与 AGG_COLS 并列；值由 PerformanceMetricsCalculator 行按 accountId 合并）。 */
    static final List<ColumnDef> AGG_PERF_COLS = List.of(
            new ColumnDef("contribution", true),
            new ColumnDef("kast", true),
            new ColumnDef("impact", true),
            new ColumnDef("multi_damage_rate", true),
            new ColumnDef("traded_deaths", true)
    );

    public static List<ColumnDef> aggregateColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        for (final AggCol c : AGG_COLS) {
            out.add(new ColumnDef(c.key(), c.num()));
        }
        out.addAll(AGG_PERF_COLS);
        return out;
    }

    public static BattleDto toBattle(final Battle b, final String sourceName, final Tankopedia tp) {
        final Function<Long, String> platoon = Players.platoonLabeler();
        final List<PlayerRow> rows = new ArrayList<>();
        for (final PlayerResult p : Players.sorted(b.players)) {
            Players.enrich(p, tp);
            p.platoonLabel = platoon.apply(p.platoonId);
            final Map<String, Object> cells = new LinkedHashMap<>();
            for (final Columns.Column c : Columns.PLAYER) {
                cells.put(c.key(), playerValue(c, p));
            }
            rows.add(new PlayerRow(cells, p.team));
        }
        return new BattleDto(b.arenaId, b.mapName, b.version, b.durationS,
                b.startTime, b.winnerTeam, sourceName, rows);
    }

    public static List<AggRow> toAggregate(final Map<Long, Agg> aggMap,
                                        final Map<Long, PerformanceMetricsCalculator.Row> perfById) {
        final List<Agg> list = new ArrayList<>(aggMap.values());
        list.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        final List<AggRow> out = new ArrayList<>();
        for (final Agg a : list) {
            final Map<String, Object> cells = new LinkedHashMap<>();
            for (final AggCol c : AGG_COLS) {
                cells.put(c.key(), c.get().apply(a));
            }
            final PerformanceMetricsCalculator.Row perf = perfById.get(a.accountId);
            if (perf != null) {
                // 跨场表现派生列：HP 全部 UNKNOWN 时 contribution/kast/多伤率 unavailable（null，UI 显示 "--"）
                cells.put("contribution", perf.hpEligible ? r1(perf.contribution) : null);
                cells.put("kast", perf.hpEligible ? r1(perf.kast) : null);
                cells.put("impact", r1(perf.impactValue));
                cells.put("multi_damage_rate", perf.hpEligible ? r1(perf.multiDamageRate) : null);
                cells.put("traded_deaths", perf.tradedDeaths);
            } else {
                cells.put("contribution", null);
                cells.put("kast", null);
                cells.put("impact", null);
                cells.put("multi_damage_rate", null);
                cells.put("traded_deaths", 0);
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

    private static Object playerValue(final Columns.Column column, final PlayerResult player) {
        return switch (column.key()) {
            case "tank_type" -> VehicleCodes.classCode(player.tankType);
            case "tank_nation" -> VehicleCodes.nationCode(player.tankNation);
            case "survived_label" -> player.survived ? "SURVIVED" : "DESTROYED";
            case "potential_damage_detail" -> player.potentialDamageDetailed ? "PARSED" : "UNPARSED";
            default -> column.get().apply(player);
        };
    }
}
