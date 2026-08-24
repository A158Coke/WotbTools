package com.wotb.core.league;

import com.wotb.core.model.Battle;

import java.util.List;

/**
 * 回放批次的 League Rating 模式。
 *
 * <p>基于 meta.json#arenaBonusType（证据见 {@code docs/features/hall-of-fame.md} 证据矩阵
 * 与 {@code docs/research/replay/protocol.md}）：
 * <ul>
 *   <li>2 = 训练房（Training）——项目真实夹具 training-room-example.wotbreplay 实解；</li>
 *   <li>4 = 联赛/锦标赛（Tournament，supremacy）——项目真实样本（protocol.md 5 个真实回放）。</li>
 * </ul>
 * 其余（1=随机战斗、7=游戏内评级、8=Mad Games、未知）一律属于普通回放。</p>
 *
 * <p>批次模式：所有成功解析的回放同为 LEAGUE → {@link #LEAGUE_RATING}；同为非 LEAGUE →
 * {@link #STANDARD_REPLAY}；两类混合 → {@link #MIXED_UNSUPPORTED}（League Rating 不聚合
 * 混合批次；battles 仍按普通回放语义成功返回，League Analysis unavailable 由调用方提示）。</p>
 */
public enum LeagueRatingMode {

    /** 普通回放（不含训练赛/联赛）：保持现有回放解析契约。 */
    STANDARD_REPLAY,

    /** 训练赛/联赛回放：执行严格完整性校验并计算 League Rating。 */
    LEAGUE_RATING,

    /** 同一批次同时出现普通回放与训练赛/联赛回放：League Rating 不聚合；解析仍成功（plan §21）。 */
    MIXED_UNSUPPORTED;

    /** 训练房 raw arenaBonusType（项目真实夹具证据）。 */
    public static final int ARENA_BONUS_TYPE_TRAINING = 2;

    /** 联赛/锦标赛 raw arenaBonusType（项目真实样本证据）。 */
    public static final int ARENA_BONUS_TYPE_TOURNAMENT = 4;

    /** 该 arenaBonusType 是否属于训练赛/联赛（League Rating 准入范围）。 */
    public static boolean isLeague(final Integer arenaBonusType) {
        return arenaBonusType != null
                && (arenaBonusType == ARENA_BONUS_TYPE_TRAINING
                || arenaBonusType == ARENA_BONUS_TYPE_TOURNAMENT);
    }

    /** 单场是否属于训练赛/联赛。 */
    public static boolean isLeague(final Battle battle) {
        return battle != null && isLeague(battle.arenaBonusType);
    }

    /**
     * 批次模式判定：只看成功解析的回放（解析失败按既有 failures 报告，不参与模式）。
     *
     * @param battles 成功解析的 battle 列表
     * @return 全 LEAGUE → {@link #LEAGUE_RATING}；全普通 → {@link #STANDARD_REPLAY}；混合 →
     *         {@link #MIXED_UNSUPPORTED}
     */
    public static LeagueRatingMode classify(final List<Battle> battles) {
        if (battles == null || battles.isEmpty()) {
            return STANDARD_REPLAY;
        }
        boolean hasLeague = false;
        boolean hasStandard = false;
        for (final Battle battle : battles) {
            if (isLeague(battle)) {
                hasLeague = true;
            } else {
                hasStandard = true;
            }
        }
        if (hasLeague && hasStandard) {
            return MIXED_UNSUPPORTED;
        }
        return hasLeague ? LEAGUE_RATING : STANDARD_REPLAY;
    }
}
