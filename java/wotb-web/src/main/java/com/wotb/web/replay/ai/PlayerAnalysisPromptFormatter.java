package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.util.PlayerResultFormat;

import java.util.List;
import java.util.Map;

/**
 * Formats player data for AI prompts using FRIENDLY / ENEMY / UNKNOWN labels
 * instead of raw team numbers.
 * <p>
 * This is a SEPARATE formatter from {@link PlayerResultFormat} —
 * it does NOT modify the shared format methods used by Excel export or other features.
 */
public final class PlayerAnalysisPromptFormatter {

    private PlayerAnalysisPromptFormatter() {}

    /**
     * 阵营称呼。随机战个人复盘直接面向玩家本人，同队一律称「队友」而非「友方」，
     * 避免玩家本人被当作「友方」而不是「你」。
     */
    public static String sideLabel(final Side side) {
        return switch (side) {
            case FRIENDLY -> "队友";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知";
        };
    }

    public static String formatPlayerLine(final PlayerResult p, final Side side) {
        return "- " + sideLabel(side)
                + " " + PlayerResultFormat.quoteForPrompt(p.nickname)
                + " (" + PlayerResultFormat.quoteForPrompt(resolveTank(p)) + ")"
                + " 输出" + p.damageDealt
                + " 承伤" + p.damageReceived
                + " 助攻" + p.damageAssisted
                + " 格挡" + p.damageBlocked
                + " 击杀" + p.kills
                + " " + PlayerResultFormat.deathDisplay(p);
    }

    /**
     * 玩家本人的战绩行。复盘直接面向本人，这里写「你」而不是「录像者」，
     * 也不再标注阵营 —— 本人既不是「友方」也不是「队友」。
     * {@code side} 仅用于保持调用方签名，不进入输出。
     */
    public static String formatRecorderLine(final PlayerResult rec, final Side side) {
        return "你: " + PlayerResultFormat.quoteForPrompt(rec.nickname)
                + " (" + PlayerResultFormat.quoteForPrompt(resolveTank(rec)) + ")"
                + " | " + PlayerResultFormat.deathDisplay(rec)
                + " | 输出" + rec.damageDealt
                + " | 承伤" + rec.damageReceived
                + " | 助攻" + rec.damageAssisted
                + " | 格挡" + rec.damageBlocked
                + " | 击杀" + rec.kills;
    }

    private static String resolveTank(final PlayerResult p) {
        return ReplayDisplayNames.tankName(p.tankId, p.tankName);
    }

    public static String formatAllPlayersBySide(final Battle battle) {
        if (battle == null || battle.players == null) return "";
        final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        final StringBuilder sb = new StringBuilder(2048);

        appendGroup(sb, "队友", sides, Side.FRIENDLY);
        appendGroup(sb, "敌方", sides, Side.ENEMY);
        appendGroup(sb, "未知", sides, Side.UNKNOWN);

        return sb.toString();
    }

    private static void appendGroup(final StringBuilder sb, final String heading,
                                    final Map<PlayerResult, Side> sides, final Side side) {
        final List<PlayerResult> filtered = sides.entrySet().stream()
                .filter(e -> e.getValue() == side)
                .map(Map.Entry::getKey)
                .toList();
        if (filtered.isEmpty()) return;
        sb.append("=== ").append(heading).append(" ===\n");
        filtered.forEach(p -> sb.append(formatPlayerLine(p, side)).append('\n'));
    }

    public static String formatWinner(final Battle battle) {
        final Winner w = FriendlyEnemyResult.resolve(battle);
        return "结果: " + FriendlyEnemyResult.label(w);
    }
}
