package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.EngagementOutcome;
import com.wotb.core.replay.feature.MovementType;

/**
 * 证据中所有枚举/机器标签的中文显示名。
 * <p>后端枚举常量（{@code MID_GAME}、{@code FAVORABLE} …）是内部标识，
 * 直接写进 prompt 会被模型原样抄进中文复盘。证据统一改用本类的中文术语，
 * 让模型没有可抄的英文。</p>
 * <p>稳定英文错误码与 limitation 码不在此列：它们由前端三语词典本地化，
 * 必须保持英文原样。</p>
 */
public final class PlayerAnalysisTerms {

    private PlayerAnalysisTerms() {
    }

    /** 战斗阶段。 */
    public static String phaseLabel(final BattlePhaseType type) {
        if (type == null) return "未知阶段";
        return switch (type) {
            case PRE_BATTLE -> "准备阶段";
            case OPENING -> "开局";
            case FIRST_CONTACT -> "首次接敌";
            case MID_GAME -> "中期";
            case LATE_GAME -> "后期";
            case ENDGAME -> "残局";
            case POST_BATTLE -> "战斗结束后";
            case UNKNOWN -> "未知阶段";
        };
    }

    /** 交火结果。 */
    public static String outcomeLabel(final EngagementOutcome outcome) {
        if (outcome == null) return "未知";
        return switch (outcome) {
            case FAVORABLE -> "有利";
            case UNFAVORABLE -> "不利";
            case EVEN -> "均势";
            case UNKNOWN -> "未知";
        };
    }

    /** 移动状态。 */
    public static String movementLabel(final MovementType type) {
        if (type == null) return "未知";
        return switch (type) {
            case MOVING -> "移动";
            case STATIONARY -> "静止";
            case UNKNOWN -> "未知";
        };
    }

    /** 解码置信度。 */
    public static String confidenceLabel(final DecodeConfidence confidence) {
        if (confidence == null) return "未知";
        return switch (confidence) {
            case EXACT -> "精确";
            case INFERRED -> "推算";
            case PARTIAL -> "部分";
            case UNKNOWN -> "未知";
        };
    }

    /** 关键事件类型。未知类型原样返回，避免凭空造词。 */
    public static String keyEventLabel(final String type) {
        if (type == null) return "未知事件";
        return switch (type) {
            case "VEHICLE_DESTROYED" -> "车辆被击毁";
            case "BATTLE_END" -> "战斗结束";
            case "FIRST_CONTACT" -> "首次接敌";
            default -> type;
        };
    }
}
