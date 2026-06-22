package com.wotb.core;

import com.wotb.core.model.Battle;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** 多回放: 按 arenaUniqueId 去重 (对应 Python collect_battles)。 */
public final class Replays {

    /** 一个待处理的回放 (名字 + 字节)。 */
    public record Source(String name, byte[] bytes) {
    }

    /** 去重结果。 */
    public static final class Collected {
        public final List<Battle> battles = new ArrayList<>();
        public final List<String> battleSourceNames = new ArrayList<>();  // 与 battles 对应的文件名
        public final List<String[]> duplicates = new ArrayList<>();       // [文件名, arenaId]
        public final List<String[]> failures = new ArrayList<>();         // [文件名, 错误]
    }

    private Replays() {
    }

    public static Collected collect(List<Source> sources, Consumer<String> log) {
        Collected res = new Collected();
        Map<String, String> seen = new LinkedHashMap<>(); // arenaId -> name
        for (Source s : sources) {
            Battle battle;
            try {
                battle = ReplayParser.parse(s.bytes());
            } catch (Exception e) {
                res.failures.add(new String[]{s.name(), e.getMessage()});
                if (log != null) log.accept("[失败] " + s.name() + ": " + e.getMessage());
                continue;
            }
            String aid = battle.arenaId;
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
