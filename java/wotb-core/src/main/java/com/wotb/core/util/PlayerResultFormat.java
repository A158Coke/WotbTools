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

    /** 死亡时刻（秒）：优先 deathTimeMillis，回退 survivalTimeSec。 */
    public static double deathSec(final PlayerResult p) {
        if (p.deathTimeMillis > 0) return p.deathTimeMillis / 1000.0;
        return p.survivalTimeSec;
    }

    /** 存活/阵亡文本（含秒数）。 */
    public static String deathDisplay(final PlayerResult p) {
        return p.survived ? "存活"
                : "阵亡@" + String.format("%.1f", deathSec(p)) + "s";
    }

    /** 录像者战绩行（输出/承伤/助攻/格挡/击杀/存活）。 */
    public static void appendRecorderLine(final StringBuilder sb, final PlayerResult rec) {
        sb.append(" | 输出").append(rec.damageDealt)
                .append(" 承伤").append(rec.damageReceived)
                .append(" 助攻").append(rec.damageAssisted)
                .append(" 格挡").append(rec.damageBlocked)
                .append(" 击杀").append(rec.kills)
                .append(" ").append(deathDisplay(rec));
    }

    /** 单行玩家战绩（队伍/昵称/坦克/输出/承伤/助攻/格挡/击杀/存活）。 */
    public static void appendPlayerLine(final StringBuilder sb, final PlayerResult p) {
        sb.append("- 队伍").append(p.team)
                .append(' ').append(safe(p.nickname))
                .append(" (").append(safe(p.tankName)).append(')')
                .append(" 输出").append(p.damageDealt)
                .append(" 承伤").append(p.damageReceived)
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
