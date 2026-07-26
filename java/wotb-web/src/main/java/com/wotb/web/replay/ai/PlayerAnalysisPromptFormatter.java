package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
import com.wotb.core.util.PlayerResultFormat;

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

    /** Short Chinese label for each side. */
    public static String sideLabel(final Side side) {
        return switch (side) {
            case FRIENDLY -> "友方";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知";
        };
    }

    /**
     * Format a single player line with side label instead of raw team.
     */
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

    /**
     * Format recorder line with side label.
     * E.g. "录像者: PlayerA (T110E5) | 侧=友方 | 存活 | 输出5000..."
     */
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

    /**
     * Append all players grouped by side (friendly first, enemy, unknown).
     */
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
        boolean first = true;
        for (final Map.Entry<PlayerResult, Side> e : sides.entrySet()) {
            if (e.getValue() == side) {
                if (first) {
                    sb.append("=== ").append(heading).append(" ===\n");
                    first = false;
                }
                sb.append(formatPlayerLine(e.getKey(), side)).append('\n');
            }
        }
    }

    /**
     * Format winner result as a human-readable string.
     */
    public static String formatWinner(final Battle battle) {
        final Winner w = FriendlyEnemyResult.resolve(battle);
        return "结果: " + FriendlyEnemyResult.label(w);
    }

    /** Full three-state winner label for single-battle output. */
    public static String winnerLabel(final Battle battle) {
        final Winner w = FriendlyEnemyResult.resolve(battle);
        return FriendlyEnemyResult.label(w);
    }
}
