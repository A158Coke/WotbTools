package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** 多回放: 按 arenaUniqueId 去重 */
public final class Replays {

    private Replays() {
    }

    public static Collected collect(final List<Source> sources, final Consumer<String> log) {
        final Collected res = new Collected();
        final Map<String, String> seen = new LinkedHashMap<>(); // arenaId -> name
        for (final Source s : sources) {
            final Battle battle;
            try {
                battle = ReplayParser.parse(s.bytes());
            } catch (Exception e) {
                res.failures.add(new String[]{s.name(), e.getMessage()});
                if (log != null) log.accept("[失败] " + s.name() + ": " + e.getMessage());
                continue;
            }
            final String aid = battle.arenaId;
            if (seen.containsKey(aid)) {
                res.duplicates.add(new String[]{s.name(), aid});
                if (log != null) log.accept("[跳过-重复] " + s.name() + " (与 " + seen.get(aid) + " 同一场)");
                continue;
            }
            seen.put(aid, s.name());
            res.battles.add(battle);
            res.battleSourceNames.add(s.name());
            if (log != null) {
                log.accept("[读取] " + s.name() + "  地图:" + battle.mapName + "  玩家:" + battle.nPlayers());
            }
        }
        return res;
    }
}
