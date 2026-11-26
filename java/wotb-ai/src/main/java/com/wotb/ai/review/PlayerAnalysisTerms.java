package com.wotb.ai.review;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.MovementType;

public final class PlayerAnalysisTerms {

    private PlayerAnalysisTerms() {
    }

    public static String battleClock(final float relativeSeconds) {
        final int total = Math.max(0, Math.round(relativeSeconds));
        return (total / 60) + "分" + String.format("%02d", total % 60) + "秒";
    }

    public static String battleRange(final float startSec, final float endSec) {
        return "[" + battleClock(startSec) + "-" + battleClock(endSec) + "]";
    }

    public static String survivalDisplay(final boolean survived, final double deathSec) {
        return survived ? "存活" : "阵亡@" + knownDeathClock(deathSec);
    }

    public static String knownDeathClock(final double deathSec) {
        return deathSec > 0 ? battleClock((float) deathSec) : "未知";
    }

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

    public static String movementLabel(final MovementType type) {
        if (type == null) return "未知";
        return switch (type) {
            case MOVING -> "移动";
            case STATIONARY -> "静止";
            case UNKNOWN -> "未知";
        };
    }

    public static String confidenceLabel(final DecodeConfidence confidence) {
        if (confidence == null) return "未知";
        return switch (confidence) {
            case EXACT -> "精确";
            case INFERRED -> "推算";
            case PARTIAL -> "部分";
            case UNKNOWN -> "未知";
        };
    }

    public static String keyEventLabel(final String type) {
        if (type == null || type.isBlank()) return "其他关键事件";
        return switch (type) {
            case "VEHICLE_DESTROYED" -> "车辆被击毁";
            case "BATTLE_END" -> "战斗结束";
            case "FIRST_CONTACT" -> "首次接敌";
            case "TEAM_MEMBER_DESTROYED" -> "队员阵亡";
            case "TEAM_FIRST_CONTACT" -> "团队首次接敌";
            case "TEAM_FORMATION_SPLIT" -> "队形分散";
            case "RECORDER_FIRST_BLOOD" -> "你拿下首杀";
            case "REGION_CHANGE" -> "区域变换";
            case "PLAYER_DESTROYED" -> "玩家被击毁";
            default -> type.matches("[A-Z0-9_]+") ? "其他关键事件" : type;
        };
    }
}
