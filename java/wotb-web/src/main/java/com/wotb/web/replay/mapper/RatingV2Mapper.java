package com.wotb.web.replay.mapper;

import com.wotb.core.stats.RatingV2Calculator;
import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.dto.RatingV2Row;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Maps isolated historical Rating V2 rows to the admin API's stable English-key contract. */
public final class RatingV2Mapper {

    private static final List<ColumnDef> COLUMNS = List.of(
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

    private RatingV2Mapper() {
    }

    public static List<ColumnDef> columns() {
        return COLUMNS;
    }

    public static List<RatingV2Row> toRows(final List<RatingV2Calculator.Row> ratings) {
        final List<RatingV2Row> rows = new ArrayList<>();
        for (final RatingV2Calculator.Row rating : ratings) {
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
            rows.add(new RatingV2Row(cells));
        }
        return rows;
    }

    private static double r1(final double value) {
        return Math.round(value * 10) / 10.0;
    }

    private static double r2(final double value) {
        return Math.round(value * 100) / 100.0;
    }
}
