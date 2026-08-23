package com.wotb.core.parse;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** 多回放: 按 arenaUniqueId 去重 */
public final class Replays {

    /** 单个输入回放的进度结果（无论成功/重复/失败，都推进 processed）。 */
    public enum Outcome {
        SUCCESS,
        DUPLICATE,
        FAILURE
    }

    /** 逐文件进度回调（供长任务展示真实 processed/total，不携带 web DTO）。 */
    @FunctionalInterface
    public interface ReplayProgressListener {
        void onProcessed(final Source source, final Outcome outcome);
    }

    @FunctionalInterface
    public interface BattleLoader {
        Battle load(final Source source) throws Exception;
    }

    private Replays() {
    }

    public static Collected collect(final List<Source> sources, final Consumer<String> log) {
        return collect(sources, source -> ReplayParser.parse(source.bytes()), log);
    }

    /** 按 arenaId 去重，并使用调用方指定的回放加载链路。 */
    public static Collected collect(final List<Source> sources,
                                    final BattleLoader loader,
                                    final Consumer<String> log) {
        return collect(sources, loader, log, null);
    }

    /**
     * 按 arenaId 去重，并使用调用方指定的回放加载链路；逐文件进度经
     * {@code progress} 回调（每个输入文件恰好回调一次，不依赖其结果类别）。
     */
    public static Collected collect(final List<Source> sources,
                                    final BattleLoader loader,
                                    final Consumer<String> log,
                                    final ReplayProgressListener progress) {
        final Collected res = new Collected();
        final Map<String, String> seen = new LinkedHashMap<>(); // arenaId -> name
        for (final Source s : sources) {
            final Battle battle;
            try {
                battle = loader.load(s);
                if (battle == null) {
                    throw new IllegalArgumentException("NO_BATTLE_DATA");
                }
            } catch (Exception e) {
                res.failures.add(new String[]{s.name(), e.getMessage()});
                if (log != null) log.accept("[失败] " + s.name() + ": " + e.getMessage());
                if (progress != null) progress.onProcessed(s, Outcome.FAILURE);
                continue;
            }
            final String aid = battle.arenaId;
            if (seen.containsKey(aid)) {
                res.duplicates.add(new String[]{s.name(), aid});
                if (log != null) log.accept("[跳过-重复] " + s.name() + " (与 " + seen.get(aid) + " 同一场)");
                if (progress != null) progress.onProcessed(s, Outcome.DUPLICATE);
                continue;
            }
            seen.put(aid, s.name());
            res.battles.add(battle);
            res.battleSourceNames.add(s.name());
            if (log != null) {
                log.accept("[读取] " + s.name() + "  地图:" + battle.mapName + "  玩家:" + battle.nPlayers());
            }
            if (progress != null) progress.onProcessed(s, Outcome.SUCCESS);
        }
        return res;
    }
}
