package com.wotb.core.util;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

/**
 * 玩家战绩格式化和通用查询工具（共享于 wotb-core 和 wotb-web）。
 */
public final class PlayerResultFormat {

    private PlayerResultFormat() {}

    public static String safe(final String s) {
        return (s == null || s.isBlank()) ? "?" : s;
    }

    /**
     * JSON 转义并加引号，用于 AI Prompt 不可信数据边界。
     * 委托给 {@link PromptDataQuoter#quote(String, String)}，
     * fallback 为 {@code "?"}。
     */
    public static String quoteForPrompt(final String s) {
        return PromptDataQuoter.quote(s, "?");
    }

    /**
     * 业务死亡时刻（秒）。settlement #301 field24 是唯一 authority；live event time 只属于
     * Playback / reconstruction，不得覆盖这里的秒级事实。
     */
    public static double deathSec(final PlayerResult p) {
        if (p == null || p.survived) {
            return 0;
        }
        return Double.isFinite(p.settlementLifeTimeSec) && p.settlementLifeTimeSec > 0
                ? p.settlementLifeTimeSec : 0;
    }

    /** 存活/阵亡文本（含秒数）；死亡时刻未知（deathSec<=0）时如实标注，绝不伪造 0.0s。 */
    public static String deathDisplay(final PlayerResult p) {
        if (p.survived) {
            return "存活";
        }
        final double ds = deathSec(p);
        return ds > 0 ? "阵亡@" + String.format("%.0f", ds) + "s" : "阵亡（时刻未知）";
    }

    /** 录像者战绩行（输出/损失血量/助攻/格挡/击杀/存活）。 */
    public static void appendRecorderLine(final StringBuilder sb, final PlayerResult rec) {
        sb.append(" | 输出").append(rec.damageDealt)
                .append(" 损失血量").append(rec.damageReceived)
                .append(" 助攻").append(rec.damageAssisted)
                .append(" 格挡").append(rec.damageBlocked)
                .append(" 击杀").append(rec.kills)
                .append(" ").append(deathDisplay(rec));
    }

    /** 单行玩家战绩（队伍/昵称/坦克/输出/损失血量/助攻/格挡/击杀/存活）。 */
    public static void appendPlayerLine(final StringBuilder sb, final PlayerResult p) {
        sb.append("- 队伍").append(p.team)
                .append(' ').append(safe(p.nickname))
                .append(" (").append(safe(p.tankName)).append(')')
                .append(" 输出").append(p.damageDealt)
                .append(" 损失血量").append(p.damageReceived)
                .append(" 助攻").append(p.damageAssisted)
                .append(" 格挡").append(p.damageBlocked)
                .append(" 击杀").append(p.kills)
                .append(" ").append(deathDisplay(p));
    }

    /** 全体玩家战绩（按队伍+输出降序排列）。 */
    public static void appendAllPlayers(final StringBuilder sb, final java.util.List<PlayerResult> players) {
        if (players == null) return;
        final var sorted = new java.util.ArrayList<>(players);
        sorted.sort(java.util.Comparator.<PlayerResult>comparingInt(p -> p.team)
                .thenComparing(java.util.Comparator.comparingInt((PlayerResult p) -> p.damageDealt).reversed()));
        for (final PlayerResult p : sorted) {
            appendPlayerLine(sb, p);
            sb.append('\n');
        }
    }

    /** 录像者 accountId（优先权威结算，降级 reconstruction）。 */
    public static Long recorderAccountId(final Battle battle) {
        if (battle != null) {
            final var recorder = battle.recorderResult();
            if (recorder != null && recorder.accountId > 0) return recorder.accountId;
        }
        return null;
    }

    /** 胜方队伍显示文本。 */
    public static String winnerTeamDisplay(final Battle battle) {
        return battle.winnerTeam != null ? String.valueOf(battle.winnerTeam) : "未知";
    }
}
