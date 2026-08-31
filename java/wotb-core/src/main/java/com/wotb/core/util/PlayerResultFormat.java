package com.wotb.core.util;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeObservation;
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
     * settlement/compatibility 死亡时刻（秒）。live reconstruction observation 只能通过 Battle overload 消费：
     * <ul>
     *   <li>兼容 projection 的 SETTLEMENT_SECOND → deathTimeMillis / 1000；</li>
     *   <li>存活 / UNKNOWN / 无 source → 0。</li>
     * </ul>
     *
     * <p>这是 settlement-only consumers 的唯一入口；full reconstruction consumers must use
     * {@link #deathSec(Battle, PlayerResult)}.</p>
     */
    public static double deathSec(final PlayerResult p) {
        if (p == null || p.survived || p.deathTimeSource == null) {
            return 0;
        }
        if (p.deathTimeSource == DeathTimeSource.SETTLEMENT_SECOND) {
            return p.deathTimeMillis > 0 ? p.deathTimeMillis / 1000.0 : 0;
        }
        return 0;
    }

    /**
     * Death time for a full-processing view. Live reconstruction evidence is preferred, while the
     * one-argument overload remains settlement-only for summary/League consumers.
     */
    public static double deathSec(final Battle battle, final PlayerResult p) {
        final DeathTimeObservation observation = observationOf(battle, p);
        return observation != null ? observation.timeSec() : deathSec(p);
    }

    /**
     * 死亡时刻 precision interval（SETTLEMENT_SECOND 量化）：SETTLEMENT_SECOND 有 ±0.5s 量化，consumer 不得当作
     * exact point 用于 trade / 谁先死 / 5s 窗口 / phase boundary。保存代表值 + 上下界。
     */
    public record DeathTimeEvidence(
            DeathTimeSource source,
            double representativeSec,
            double lowerBoundSec,
            double upperBoundSec) {
        public boolean known() {
            return Double.isFinite(lowerBoundSec) && Double.isFinite(upperBoundSec);
        }
    }

    /** SETTLEMENT_SECOND ±0.5s 量化。 */
    public static final double SETTLEMENT_SECOND_QUANTIZATION_HALF = 0.5;

    /**
     * 死亡时刻 evidence（含代表值与 precision interval）：LIVE_EXACT 为点（lower==upper==rep）；
     * SETTLEMENT_SECOND 为 [rep-0.5, rep+0.5]；存活 / UNKNOWN / 无 source → null（调用方 fail-closed）。
     */
    public static DeathTimeEvidence deathEvidence(final PlayerResult p) {
        if (p == null || p.survived || p.deathTimeSource == null) {
            return null;
        }
        if (p.deathTimeSource == DeathTimeSource.SETTLEMENT_SECOND && p.deathTimeMillis > 0) {
            final double rep = p.deathTimeMillis / 1000.0;
            return new DeathTimeEvidence(DeathTimeSource.SETTLEMENT_SECOND,
                    rep, rep - SETTLEMENT_SECOND_QUANTIZATION_HALF, rep + SETTLEMENT_SECOND_QUANTIZATION_HALF);
        }
        return null;
    }

    /** Death evidence for a full-processing view; live exact is a point, settlement remains interval-valued. */
    public static DeathTimeEvidence deathEvidence(final Battle battle, final PlayerResult p) {
        final DeathTimeObservation observation = observationOf(battle, p);
        if (observation != null) {
            final double sec = observation.timeSec();
            return new DeathTimeEvidence(observation.source(), sec, sec, sec);
        }
        return deathEvidence(p);
    }

    private static DeathTimeObservation observationOf(final Battle battle, final PlayerResult p) {
        if (battle == null || p == null || p.survived || battle.liveDeathObservations == null) {
            return null;
        }
        return battle.liveDeathObservations.get(p.accountId);
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
