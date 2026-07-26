package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
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

    public static String sideLabel(final Side side) {
        return switch (side) {
            case FRIENDLY -> "友方";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知";
        };
    }

    public static String formatPlayerLine(final PlayerResult p, final Side side) {
        return "- " + sideLabel(side)
                + " " + PlayerResultFormat.safe(p.nickname)
                + " (" + PlayerResultFormat.safe(p.tankName) + ")"
                + " 输出" + p.damageDealt
                + " 承伤" + p.damageReceived
                + " 助攻" + p.damageAssisted
                + " 格挡" + p.damageBlocked
                + " 击杀" + p.kills
                + " " + PlayerResultFormat.deathDisplay(p);
    }

    public static String formatRecorderLine(final PlayerResult rec, final Side side) {
        return "录像者: " + PlayerResultFormat.safe(rec.nickname)
                + " (" + PlayerResultFormat.safe(rec.tankName) + ")"
                + " | 侧=" + sideLabel(side)
                + " | " + PlayerResultFormat.deathDisplay(rec)
                + " | 输出" + rec.damageDealt
                + " | 承伤" + rec.damageReceived
                + " | 助攻" + rec.damageAssisted
                + " | 格挡" + rec.damageBlocked
                + " | 击杀" + rec.kills;
    }

    public static String formatAllPlayersBySide(final Battle battle) {
        if (battle == null || battle.players == null) return "";
        final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        final StringBuilder sb = new StringBuilder(2048);

        appendGroup(sb, "友方", sides, Side.FRIENDLY);
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
