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

    /** Short Chinese label for each side. */
    public static String sideLabel(Side side) {
        return switch (side) {
            case FRIENDLY -> "友方";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知";
        };
    }

    /** Short English label for each side. */
    public static String sideLabelEn(Side side) {
        return switch (side) {
            case FRIENDLY -> "FRIENDLY";
            case ENEMY -> "ENEMY";
            case UNKNOWN -> "UNKNOWN";
        };
    }

    /** Side label for a player given battle context. */
    public static String playerSideLabel(Battle battle, PlayerResult player) {
        return sideLabel(PlayerSideResolver.resolve(battle, player));
    }

    /**
     * Format a single player line with side label instead of raw team.
     * E.g. "- 友方 PlayerA (T110E5) 输出5000 ..."
     */
    public static String formatPlayerLine(PlayerResult p, Side side) {
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
     * E.g. "录像者 PlayerA (T110E5) 侧=友方 输出5000 ..."
     */
    public static String formatRecorderLine(PlayerResult rec, Side side) {
        return "录像者: " + PlayerResultFormat.safe(rec.nickname)
                + " (" + PlayerResultFormat.safe(rec.tankName) + ")"
                + " 侧=" + sideLabel(side)
                + PlayerResultFormat.deathDisplay(rec)
                + " 输出" + rec.damageDealt
                + " 承伤" + rec.damageReceived
                + " 助攻" + rec.damageAssisted
                + " 格挡" + rec.damageBlocked
                + " 击杀" + rec.kills;
    }

    /**
     * Append all players grouped by side (friendly first, then enemy, then unknown).
     */
    public static String formatAllPlayersBySide(Battle battle) {
        if (battle == null || battle.players == null) return "";
        Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        StringBuilder sb = new StringBuilder(2048);

        appendGroup(sb, "友方", sides, Side.FRIENDLY);
        appendGroup(sb, "敌方", sides, Side.ENEMY);
        appendGroup(sb, "未知", sides, Side.UNKNOWN);

        return sb.toString();
    }

    private static void appendGroup(StringBuilder sb, String heading,
                                     Map<PlayerResult, Side> sides, Side side) {
        boolean first = true;
        for (Map.Entry<PlayerResult, Side> e : sides.entrySet()) {
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
    public static String formatWinner(Battle battle) {
        Winner w = FriendlyEnemyResult.resolve(battle);
        return "结果: " + FriendlyEnemyResult.label(w);
    }

    /**
     * Format aggregate stats for a group of players by side.
     */
    public static String formatSideStats(List<PlayerResult> players, Side side) {
        int totalDamage = 0;
        int totalKills = 0;
        int survivors = 0;
        for (PlayerResult p : players) {
            totalDamage += p.damageDealt;
            totalKills += p.kills;
            if (p.survived) survivors++;
        }
        return sideLabel(side)
                + " 总输出=" + totalDamage
                + " 总击杀=" + totalKills
                + " 存活=" + survivors;
    }

    /**
     * Build a side-keyed stats summary given a battle.
     */
    public static String formatFriendlyEnemyStats(Battle battle) {
        if (battle == null || battle.players == null) return "";
        Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        List<PlayerResult> friendlies = new java.util.ArrayList<>();
        List<PlayerResult> enemies = new java.util.ArrayList<>();
        for (Map.Entry<PlayerResult, Side> e : sides.entrySet()) {
            switch (e.getValue()) {
                case FRIENDLY -> friendlies.add(e.getKey());
                case ENEMY -> enemies.add(e.getKey());
            }
        }
        StringBuilder sb = new StringBuilder(512);
        if (!friendlies.isEmpty()) {
            sb.append(formatSideStats(friendlies, Side.FRIENDLY)).append('\n');
        }
        if (!enemies.isEmpty()) {
            sb.append(formatSideStats(enemies, Side.ENEMY)).append('\n');
        }
        return sb.toString();
    }
}
