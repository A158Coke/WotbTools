package com.wotb.web.replay.ai;

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
                + " 损失血量" + p.damageReceived
                + " 助攻" + p.damageAssisted
                + " 格挡" + p.damageBlocked
                + " 击杀" + p.kills
                + " " + PlayerAnalysisTerms.survivalDisplay(p.survived, PlayerResultFormat.deathSec(p));
    }

    /**
     * 玩家本人的战绩行。复盘直接面向本人，这里写「你」而不是「录像者」，
     * 也不再标注阵营 —— 本人既不是「友方」也不是「队友」。
     * {@code side} 仅用于保持调用方签名，不进入输出。
     */
    public static String formatRecorderLine(final PlayerResult rec, final Side side) {
        return "你: " + PlayerResultFormat.quoteForPrompt(rec.nickname)
                + " (" + PlayerResultFormat.quoteForPrompt(resolveTank(rec)) + ")"
                + " | " + PlayerAnalysisTerms.survivalDisplay(rec.survived, PlayerResultFormat.deathSec(rec))
                + " | 输出" + rec.damageDealt
                + " | 损失血量" + rec.damageReceived
                + " | 助攻" + rec.damageAssisted
                + " | 格挡" + rec.damageBlocked
                + " | 击杀" + rec.kills;
    }

    /**
     * 判断是否同一名玩家。
     * <p>先比对象身份（名册里是同一批实例）；{@code accountId} 只在 &gt; 0 时参与，
     * 因为缺失 identity 的回放里所有 accountId 都是 0，直接按 accountId 比会把整队误判为本人。</p>
     */
    public static boolean isSamePlayer(final PlayerResult a, final PlayerResult b) {
        if (a == null || b == null) return false;
        if (a == b) return true;
        return a.accountId > 0 && a.accountId == b.accountId;
    }

    private static String resolveTank(final PlayerResult p) {
        return ReplayDisplayNames.tankName(p.tankId, p.tankName);
    }

    /**
     * 降级路径（无完整特征集）的阵容。玩家本人单独成段并称「你」，
     * 从队友组中排除 —— 本人不得同时以「你」和「队友」出现。
     */
    public static String formatAllPlayersBySide(final Battle battle) {
        if (battle == null || battle.players == null) return "";
        final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        final PlayerResult recorder = battle.recorderResult();
        final StringBuilder sb = new StringBuilder(2048);

        if (recorder != null) {
            sb.append("=== 你 ===\n")
                    .append(formatRecorderLine(recorder, sides.getOrDefault(recorder, Side.UNKNOWN)))
                    .append('\n');
        }
        appendGroup(sb, "队友", sides, Side.FRIENDLY, recorder);
        appendGroup(sb, "敌方", sides, Side.ENEMY, recorder);
        appendGroup(sb, "未知", sides, Side.UNKNOWN, recorder);

        return sb.toString();
    }

    private static void appendGroup(final StringBuilder sb, final String heading,
                                    final Map<PlayerResult, Side> sides, final Side side,
                                    final PlayerResult recorder) {
        final List<PlayerResult> filtered = sides.entrySet().stream()
                .filter(e -> e.getValue() == side)
                .map(Map.Entry::getKey)
                // 玩家本人已在「你」段输出，绝不再作为队友/敌方重复列出
                .filter(p -> !isSamePlayer(p, recorder))
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
