package com.wotb.core.league;

import java.util.List;

/**
 * League Rating 列契约（key 单一来源：API / 前端 / Excel 导出三方一致）。
 *
 * <p>列名必须与原始字段区分（「伤害」= damage_dealt 原始值；「伤害评分」= league_damage_score
 * 维度分），禁止都显示为「伤害」导致用户混淆。</p>
 */
public final class LeagueColumns {

    private LeagueColumns() {
    }

    /** 总 Rating 列 key（固定显示，不允许被 ColumnPicker 隐藏）。 */
    public static final String RATING = "league_rating";

    /** Raw Batch Median 列 key（V5 explainability：玩家自己的单场 V4.1 Rating 中位数；
     *  默认可隐藏，不是主 Rating）。 */
    public static final String RATING_RAW_MEDIAN = "league_rating_raw_median";

    /** 七个 Rating 维度列 key（顺序与 {@link #DIM_MAX} 对齐）。 */
    public static final List<String> DIM_KEYS = List.of(
            "league_damage_score",
            "league_assist_score",
            "league_kill_score",
            "league_exchange_score",
            "league_blocked_score",
            "league_survival_score",
            "league_shooting_score");

    /** 七个维度满分（顺序与 {@link #DIM_KEYS} 对齐，合计 1000）。 */
    public static final List<Double> DIM_MAX = List.of(
            PlayerLeagueRating.MAX_DAMAGE,
            PlayerLeagueRating.MAX_ASSIST,
            PlayerLeagueRating.MAX_KILL,
            PlayerLeagueRating.MAX_EXCHANGE,
            PlayerLeagueRating.MAX_BLOCKED,
            PlayerLeagueRating.MAX_SURVIVAL_TRADE,
            PlayerLeagueRating.MAX_SHOOTING);

    /** 占点原始字段列 key（backend/export facts）：earned → CW 主 UI 展示；
     *  seized → backend fact 保留、XLSX 可导出、CW 主 UI 不展示。 */
    public static final String VICTORY_POINTS_EARNED = "victory_points_earned";
    public static final String VICTORY_POINTS_SEIZED = "victory_points_seized";

    /** League 模式默认可见列（玩家/战队/车辆/伤害/助攻/击杀/总 Rating）。 */
    public static final List<String> DEFAULT_VISIBLE = List.of(
            "nickname", "clan", "tank_name", "damage_dealt", "damage_assisted", "kills", RATING);

    /** 玩家表固定列（player + 总 Rating；不可移动，sticky 布局依据）。 */
    public static final List<String> FIXED_PLAYER_COLUMNS = List.of("nickname", RATING);

    /** 单个维度分占位 key（打分时按序号访问 {@link #DIM_KEYS}）。 */
    public static String dimKey(final int index) {
        return DIM_KEYS.get(index);
    }

    /** 单个维度满分。 */
    public static double dimMax(final int index) {
        return DIM_MAX.get(index);
    }
}
