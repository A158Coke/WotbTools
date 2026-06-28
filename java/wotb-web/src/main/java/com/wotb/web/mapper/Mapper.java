package com.wotb.web.mapper;

import com.wotb.core.Columns;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Players;
import com.wotb.core.stats.RatingAnalyzer;
import com.wotb.web.dto.AggRow;
import com.wotb.web.dto.BattleDto;
import com.wotb.web.dto.ColumnDef;
import com.wotb.web.dto.PlayerRow;
import com.wotb.web.dto.RatingRow;

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
            new AggCol("rating_avg", true, a -> Math.round(a.avgRating())),
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

    public static List<ColumnDef> aggregateColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        for (final AggCol c : AGG_COLS) {
            out.add(new ColumnDef(c.key(), c.num()));
        }
        return out;
    }

    static final List<ColumnDef> RATING_COLS = List.of(
            new ColumnDef("nickname", false),
            new ColumnDef("clan", false),
            new ColumnDef("battles", true),
            new ColumnDef("wins", true),
            new ColumnDef("win_rate", true),
            new ColumnDef("rating", true),
            new ColumnDef("kast", true),
            new ColumnDef("contribution", true),
            new ColumnDef("impact", true),
            new ColumnDef("damage_avg", true),
            new ColumnDef("potential_damage_avg", true),
            new ColumnDef("potential_damage_supplement_avg", true),
            new ColumnDef("assist_avg", true),
            new ColumnDef("multi_damage_rate", true),
            new ColumnDef("kills", true),
            new ColumnDef("kills_avg", true)
    );

    public static List<ColumnDef> ratingColumns() {
        return RATING_COLS;
    }

    public static BattleDto toBattle(final Battle b, final String sourceName, final Tankopedia tp) {
        final Function<Long, String> platoon = Players.platoonLabeler();
        final List<PlayerRow> rows = new ArrayList<>();
        for (final PlayerResult p : Players.sorted(b.players)) {
            Players.enrich(p, tp);
            p.platoonLabel = platoon.apply(p.platoonId);
            final Map<String, Object> cells = new LinkedHashMap<>();
            for (final Columns.Column c : Columns.PLAYER) {
                cells.put(c.key(), c.get().apply(p));
            }
            rows.add(new PlayerRow(cells, p.team));
        }
        return new BattleDto(b.arenaId, b.mapName, b.version, b.durationS,
                b.startTime, b.winnerTeam, sourceName, rows);
    }

    public static List<AggRow> toAggregate(final Map<Long, Agg> aggMap) {
        final List<Agg> list = new ArrayList<>(aggMap.values());
        list.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        final List<AggRow> out = new ArrayList<>();
        for (final Agg a : list) {
            final Map<String, Object> cells = new LinkedHashMap<>();
            for (final AggCol c : AGG_COLS) {
                cells.put(c.key(), c.get().apply(a));
            }
            out.add(new AggRow(cells, a.team));
        }
        return out;
    }

    public static List<RatingRow> toRatings(final List<RatingAnalyzer.Row> ratings) {
        final List<RatingRow> out = new ArrayList<>();
        for (final RatingAnalyzer.Row rating : ratings) {
            final Map<String, Object> cells = new LinkedHashMap<>();
            cells.put("nickname", rating.nickname);
            cells.put("clan", rating.clan);
            cells.put("battles", rating.battles);
            cells.put("wins", rating.wins);
            cells.put("win_rate", r1(rating.winRate()));
            cells.put("rating", rating.rating);
            cells.put("kast", r1(rating.kast));
            cells.put("contribution", r1(rating.contribution));
            cells.put("impact", rating.impact);
            cells.put("damage_avg", r1(rating.damageAvg));
            cells.put("potential_damage_avg", r1(rating.potentialDamageAvg));
            cells.put("potential_damage_supplement_avg", r1(rating.potentialDamageSupplementAvg));
            cells.put("assist_avg", r1(rating.assistAvg));
            cells.put("multi_damage_rate", r1(rating.multiDamageRate));
            cells.put("kills", rating.kills);
            cells.put("kills_avg", r2(rating.killsAvg));
            out.add(new RatingRow(cells));
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
