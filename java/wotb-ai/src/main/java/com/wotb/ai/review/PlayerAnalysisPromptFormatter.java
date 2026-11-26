package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.util.PlayerResultFormat;

import java.util.List;
import java.util.Map;

public final class PlayerAnalysisPromptFormatter {

    private PlayerAnalysisPromptFormatter() {}

    public static String sideLabel(final Side side) {
        return switch (side) {
            case FRIENDLY -> "队友";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知";
        };
    }

    public static String formatPlayerLine(final PlayerResult p, final Side side) {
        return formatPlayerLine(null, p, side);
    }

    public static String formatPlayerLine(final Battle battle, final PlayerResult p, final Side side) {
        return "- " + sideLabel(side)
                + " " + PlayerResultFormat.quoteForPrompt(p.nickname)
                + " (" + PlayerResultFormat.quoteForPrompt(resolveTank(p)) + ")"
                + " 输出" + p.damageDealt
                + " 损失血量" + p.damageReceived
                + " 助攻" + p.damageAssisted
                + " 格挡" + p.damageBlocked
                + " 击杀" + p.kills
                + " " + PlayerAnalysisTerms.survivalDisplay(p.survived, PlayerResultFormat.deathSec(p));
    }

    public static String formatRecorderLine(final PlayerResult rec, final Side side) {
        return formatRecorderLine(null, rec, side);
    }

    public static String formatRecorderLine(final Battle battle, final PlayerResult rec, final Side side) {
        return "你: " + PlayerResultFormat.quoteForPrompt(rec.nickname)
                + " (" + PlayerResultFormat.quoteForPrompt(resolveTank(rec)) + ")"
                + " | " + PlayerAnalysisTerms.survivalDisplay(rec.survived, PlayerResultFormat.deathSec(rec))
                + " | 输出" + rec.damageDealt
                + " | 损失血量" + rec.damageReceived
                + " | 助攻" + rec.damageAssisted
                + " | 格挡" + rec.damageBlocked
                + " | 击杀" + rec.kills;
    }

    public static boolean isSamePlayer(final PlayerResult a, final PlayerResult b) {
        if (a == null || b == null) return false;
        if (a == b) return true;
        return a.accountId > 0 && a.accountId == b.accountId;
    }

    private static String resolveTank(final PlayerResult p) {
        return ReplayDisplayNames.tankName(p.tankId, p.tankName);
    }

    public static String formatAllPlayersBySide(final Battle battle) {
        if (battle == null || battle.players == null) return "";
        final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        final PlayerResult recorder = battle.recorderResult();
        final StringBuilder sb = new StringBuilder(2048);

        if (recorder != null) {
            sb.append("=== 你 ===\n")
                    .append(formatRecorderLine(battle, recorder, sides.getOrDefault(recorder, Side.UNKNOWN)))
                    .append('\n');
        }
        appendGroup(sb, battle, "队友", sides, Side.FRIENDLY, recorder);
        appendGroup(sb, battle, "敌方", sides, Side.ENEMY, recorder);
        appendGroup(sb, battle, "未知", sides, Side.UNKNOWN, recorder);

        return sb.toString();
    }

    private static void appendGroup(final StringBuilder sb, final Battle battle, final String heading,
                                    final Map<PlayerResult, Side> sides, final Side side,
                                    final PlayerResult recorder) {
        final List<PlayerResult> filtered = sides.entrySet().stream()
                .filter(e -> e.getValue() == side)
                .map(Map.Entry::getKey)
                .filter(p -> !isSamePlayer(p, recorder))
                .toList();
        if (filtered.isEmpty()) return;
        sb.append("=== ").append(heading).append(" ===\n");
        filtered.forEach(p -> sb.append(formatPlayerLine(battle, p, side)).append('\n'));
    }

    public static String formatWinner(final Battle battle) {
        final Winner w = FriendlyEnemyResult.resolve(battle);
        return "结果: " + FriendlyEnemyResult.label(w);
    }
}
