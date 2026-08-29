package com.wotb.core.parse;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.Source;

import java.util.ArrayList;
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

    /** 逐文件进度回调（供长任务展示真实 processed/total；不携带 Source/byte[]）。 */
    @FunctionalInterface
    public interface ReplayProgressListener {
        void onProcessed(final int sourceIndex, final String sourceName, final Outcome outcome);
    }

    @FunctionalInterface
    public interface BattleLoader {
        Battle load(final Source source) throws Exception;
    }

    /**
     * 一个输入文件的轻量解析结果（成功 → {@code battle != null}；失败 →
     * {@code failureMessage != null}）。<b>不持有 {@link Source} / byte[]</b>——
     * 解析完成后 batch 聚合阶段不再需要原始字节。
     */
    public record ParsedEntry(int sourceIndex, String sourceName, Battle battle, String failureMessage) {
        public boolean failed() {
            return failureMessage != null;
        }
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
        return dedupe(parseAll(sources, loader, log), log, progress);
    }

    /** 解析全部输入（不去重、不回调 progress）；解析失败保留在 entry.failureMessage。 */
    public static List<ParsedEntry> parseAll(final List<Source> sources,
                                             final BattleLoader loader,
                                             final Consumer<String> log) {
        final List<ParsedEntry> entries = new ArrayList<>(sources.size());
        for (int i = 0; i < sources.size(); i++) {
            final Source s = sources.get(i);
            final Battle battle;
            try {
                battle = loader.load(s);
                if (battle == null) {
                    throw new IllegalArgumentException("NO_BATTLE_DATA");
                }
            } catch (final Exception e) {
                if (log != null) {
                    log.accept("[失败] " + s.name() + ": " + e.getMessage());
                }
                entries.add(new ParsedEntry(i, s.name(), null, e.getMessage()));
                continue;
            }
            entries.add(new ParsedEntry(i, s.name(), battle, null));
        }
        return entries;
    }

    /** 按 arenaId 去重（first-wins），并为每个输入文件恰好回调一次 progress。 */
    public static Collected dedupe(final List<ParsedEntry> entries,
                                   final Consumer<String> log,
                                   final ReplayProgressListener progress) {
        final Collected res = new Collected();
        final Map<String, String> seen = new LinkedHashMap<>(); // arenaId -> name
        for (final ParsedEntry entry : entries) {
            if (entry.failed()) {
                res.failures.add(new String[]{entry.sourceName(), entry.failureMessage()});
                if (progress != null) {
                    progress.onProcessed(entry.sourceIndex(), entry.sourceName(), Outcome.FAILURE);
                }
                continue;
            }
            final Battle battle = entry.battle();
            final String aid = battle.arenaId;
            if (seen.containsKey(aid)) {
                res.duplicates.add(new String[]{entry.sourceName(), aid});
                if (log != null) {
                    log.accept("[跳过-重复] " + entry.sourceName() + " (与 " + seen.get(aid) + " 同一场)");
                }
                if (progress != null) {
                    progress.onProcessed(entry.sourceIndex(), entry.sourceName(), Outcome.DUPLICATE);
                }
                continue;
            }
            seen.put(aid, entry.sourceName());
            res.battles.add(battle);
            res.battleSourceNames.add(entry.sourceName());
            if (log != null) {
                log.accept("[读取] " + entry.sourceName() + "  地图:" + battle.mapName + "  玩家:" + battle.nPlayers());
            }
            if (progress != null) {
                progress.onProcessed(entry.sourceIndex(), entry.sourceName(), Outcome.SUCCESS);
            }
        }
        return res;
    }
}
