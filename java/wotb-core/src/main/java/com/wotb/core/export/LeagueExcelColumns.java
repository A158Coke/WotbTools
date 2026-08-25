package com.wotb.core.export;

import com.wotb.core.league.LeagueColumns;

import java.util.Map;

/**
 * League Rating Excel 七维标题的 presentation 单一事实源（key → 中文标题）。
 *
 * <p>业务侧（key / max / ordered score）由 {@link LeagueColumns} 与
 * {@code PlayerLeagueRating.dimensionScores()} 管理；本类只负责 Excel 展示标题，
 * 并保证映射对 canonical {@link LeagueColumns#DIM_KEYS} 全量覆盖：
 * 新增维度但忘加标题、或留下未使用的标题 key，都在类加载期直接失败。</p>
 *
 * <p>consumer（{@link LeagueSingleSheets} / {@link LeagueAggregateSheets}）一律按
 * {@code LeagueColumns.DIM_KEYS} 遍历取标题，禁止按 index 与 score/median 列表
 * 碰巧对齐。</p>
 */
final class LeagueExcelColumns {

    private static final Map<String, String> DIMENSION_TITLES = Map.of(
            "league_damage_score", "伤害评分",
            "league_assist_score", "助攻评分",
            "league_kill_score", "击杀评分",
            "league_exchange_score", "换血效率评分",
            "league_blocked_score", "阻挡评分",
            "league_survival_score", "存活/互换评分",
            "league_shooting_score", "射击效率评分");

    static {
        // fail-fast：DIM_KEYS 每个 key 必须有标题（新增维度忘加标题 → 类加载失败）
        for (final String key : LeagueColumns.DIM_KEYS) {
            if (!DIMENSION_TITLES.containsKey(key)) {
                throw new IllegalStateException(
                        "League dimension Excel title missing for canonical key: " + key);
            }
        }
        // fail-fast：不允许存在不在 DIM_KEYS 中的多余标题 key
        for (final String key : DIMENSION_TITLES.keySet()) {
            if (!LeagueColumns.DIM_KEYS.contains(key)) {
                throw new IllegalStateException("unused League dimension title key: " + key);
            }
        }
    }

    private LeagueExcelColumns() {
    }

    /** 七维 Excel 中文标题（key 必须属于 {@link LeagueColumns#DIM_KEYS}，未知 key 立即失败）。 */
    static String dimensionTitle(final String key) {
        final String title = DIMENSION_TITLES.get(key);
        if (title == null) {
            throw new IllegalArgumentException("unknown League dimension key: " + key);
        }
        return title;
    }
}
