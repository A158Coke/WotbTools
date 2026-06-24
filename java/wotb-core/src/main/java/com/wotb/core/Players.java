package com.wotb.core;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;

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
        p.tankName = ti.name;
        p.tankTier = ti.tier;
        p.tankType = ti.type;
        p.tankNation = ti.nation;
    }

    /** 统一排序: 先队伍, 同队按伤害降序。 */
    public static List<PlayerResult> sorted(final List<PlayerResult> players) {
        return players.stream()
                .sorted(Comparator.<PlayerResult>comparingInt(p -> p.team)
                        .thenComparing(Comparator.comparingInt((PlayerResult p) -> p.damageDealt).reversed()))
                .collect(Collectors.toList());
    }

    /** 返回一个把 platoonId 映射成 A/B/C… 的函数 (每次调用独立计数)。 */
    public static Function<Long, String> platoonLabeler() {
        final Map<Long, String> letters = new HashMap<>();
        return pid -> {
            if (pid == null || pid == 0) {
                return "";
            }
            return letters.computeIfAbsent(pid, k -> String.valueOf((char) ('A' + letters.size())));
        };
    }
}
