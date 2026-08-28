package com.wotb.core.stats;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 玩家记录的展示派生 / 排序 / 排号工具 (对应 Python 的 enrich_display / sort_players)。 */
public final class Players {

    public static final Map<Integer, String> TEAM_NAME = Map.of(1, "队伍A", 2, "队伍B");

    private Players() {
    }

    /** 补上展示用派生字段 (车名/车种/国家)。 */
    public static void enrich(final PlayerResult p, final Tankopedia tp) {
        final TankInfo ti = tp.info(p.tankId);
        p.tankName = ti.name();
        p.tankTier = ti.tier();
        p.tankType = ti.type();
        p.tankNation = ti.nation();
        p.alphaDamage = ti.alphaDamage() == null ? "" : ti.alphaDamage();
    }

    /** 统一排序: 先队伍, 同队按伤害降序。 */
    public static List<PlayerResult> sorted(final List<PlayerResult> players) {
        return players.stream()
                .sorted(Comparator.<PlayerResult>comparingInt(p -> p.team)
                        .thenComparing(Comparator.comparingInt((PlayerResult p) -> p.damageDealt).reversed()))
                .collect(Collectors.toList());
    }
}


