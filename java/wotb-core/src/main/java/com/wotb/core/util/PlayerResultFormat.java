package com.wotb.core.util;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
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
     * 死亡时刻（秒），按 §B1 deathTimeSource 权威链：
     * LIVE_EXACT → {@code survivalTimeSec}（回放精确 sub-second，覆盖结算）；
     * SETTLEMENT_SECOND → {@code deathTimeMillis / 1000}（±0.5s 量化）；
     * 无 source 但 {@code survivalTimeSec > 0} → {@code survivalTimeSec}（canonical 收口后的
     * KNOWN 死亡时刻：生产上非存活且 {@code survivalTimeSec > 0} 只由 ReplayParser 结算
     * 或 DeathTimeReconciler LIVE_EXACT 写入，绝不来自 legacy 启发式）；
     * 存活 / 全 UNKNOWN → 0（绝不伪造死亡时刻）。
     *
     * <p>这是所有 Trade/KAST/League/AI 死亡时刻消费方的唯一入口（§6 集中 eligibility），
     * 业务层禁止各自从 {@code survivalTimeSec}/{@code deathTimeMillis} 重新推断。</p>
     */
    public static double deathSec(final PlayerResult p) {
        if (p == null || p.survived) {
            return 0;
        }
        if (p.deathTimeSource == DeathTimeSource.LIVE_EXACT) {
            return p.survivalTimeSec > 0 ? p.survivalTimeSec : 0;
        }
        if (p.deathTimeSource == DeathTimeSource.SETTLEMENT_SECOND) {
            return p.deathTimeMillis > 0 ? p.deathTimeMillis / 1000.0 : 0;
        }
        if (p.deathTimeMillis > 0) {
            return p.deathTimeMillis / 1000.0;
        }
        return p.survivalTimeSec > 0 ? p.survivalTimeSec : 0;
    }

    /** 存活/阵亡文本（含秒数）；死亡时刻未知（deathSec<=0）时如实标注，绝不伪造 0.0s。 */
    public static String deathDisplay(final PlayerResult p) {
        if (p.survived) {
            return "存活";
        }
        final double ds = deathSec(p);
        return ds > 0 ? "阵亡@" + String.format("%.1f", ds) + "s" : "阵亡（时刻未知）";
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