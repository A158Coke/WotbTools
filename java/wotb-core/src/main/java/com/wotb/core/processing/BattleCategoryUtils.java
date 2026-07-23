package com.wotb.core.processing;

/**
 * BattleCategory 识别工具。
 * 从 meta.json#arenaBonusType 映射。
 */
public final class BattleCategoryUtils {

    private BattleCategoryUtils() {}

    /**
     * 从 arenaBonusType 映射 BattleCategory。
     *
     * @param arenaBonusType 回放元数据中的 arenaBonusType（可为 null）
     * @return 战斗类型
     */
    public static BattleCategory fromArenaBonusType(Integer arenaBonusType) {
        if (arenaBonusType == null) return BattleCategory.UNKNOWN;
        return switch (arenaBonusType) {
            case 1 -> BattleCategory.RANDOM;
            case 2 -> BattleCategory.TRAINING;
            case 3, 4, 5, 6, 7, 8, 9, 10 -> BattleCategory.TOURNAMENT;
            default -> BattleCategory.UNKNOWN;
        };
    }

    /**
     * 根据 BattleCategory 解析 AI 分析范围。
     */
    public static ReplayAnalysisScope resolveScope(BattleCategory category) {
        return switch (category) {
            case RANDOM -> ReplayAnalysisScope.PLAYER_FOCUSED;
            case TRAINING, TOURNAMENT -> ReplayAnalysisScope.TEAM_PERSPECTIVE;
            case UNKNOWN -> throw new UnsupportedBattleCategoryException(
                    "Cannot resolve analysis scope for UNKNOWN battle category");
        };
    }

    /**
     * 从 arenaBonusType 直接解析 scope。
     */
    public static ReplayAnalysisScope scopeFromArenaBonusType(Integer arenaBonusType) {
        return resolveScope(fromArenaBonusType(arenaBonusType));
    }
}
