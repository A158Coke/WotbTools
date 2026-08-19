package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseType;
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

    /**
     * 战斗相对秒数 → {@code X分XX秒}。复盘正文要求统一使用该格式，
     * 证据里也直接给出，避免模型自行换算出错。负值按 0 处理。
     */
    public static String battleClock(final float relativeSeconds) {
        final int total = Math.max(0, Math.round(relativeSeconds));
        return (total / 60) + "分" + String.format("%02d", total % 60) + "秒";
    }

    /**
     * 战斗时间范围，例如 {@code [0分10秒-0分25秒]}。
     */
    public static String battleRange(final float startSec, final float endSec) {
        return "[" + battleClock(startSec) + "-" + battleClock(endSec) + "]";
    }

    /**
     * AI prompt 专用的存活/阵亡显示。
     * <p>不复用共享的 {@code PlayerResultFormat.deathDisplay()}：那个方法还服务于
     * 非 AI 调用方（导出/前端），改它会波及无关输出。这里只负责 AI 侧的 {@code X分XX秒}。</p>
     */
    public static String survivalDisplay(final boolean survived, final double deathSec) {
        return survived ? "存活" : "阵亡@" + knownDeathClock(deathSec);
    }

    /**
     * 死亡时刻（秒）→ {@code X分XX秒}；未知（{@code deathSec <= 0}）→ 「未知」。
     * <p>阵亡玩家可能因结算缺失 + 事件流 fallback 失败而时刻未知（deathSec=0），
     * 此时绝不能格式化成 {@code 0分00秒}（错误确定性证据），统一输出「未知」。</p>
     */
    public static String knownDeathClock(final double deathSec) {
        return deathSec > 0 ? battleClock((float) deathSec) : "未知";
    }

    /**
     * 战斗阶段。
     */
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

    /**
     * 移动状态。
     */
    public static String movementLabel(final MovementType type) {
        if (type == null) return "未知";
        return switch (type) {
            case MOVING -> "移动";
            case STATIONARY -> "静止";
            case UNKNOWN -> "未知";
        };
    }

    /**
     * 解码置信度。
     */
    public static String confidenceLabel(final DecodeConfidence confidence) {
        if (confidence == null) return "未知";
        return switch (confidence) {
            case EXACT -> "精确";
            case INFERRED -> "推算";
            case PARTIAL -> "部分";
            case UNKNOWN -> "未知";
        };
    }

    /**
     * 关键事件类型。未知的全大写机器标签不得直接进入 prompt，
     * 统一回退为「其他关键事件」；非机器标签（已是可读文本）原样返回。
     */
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
            // 只有真正未知的全大写机器标签才回退为通用中文
            default -> type.matches("[A-Z0-9_]+") ? "其他关键事件" : type;
        };
    }
}
