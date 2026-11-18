package com.wotb.ai.review;

import com.wotb.core.ai.EntityIdentityResolver;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.util.PlayerResultFormat;

/** Shared actor and tank text used by player evidence owners. */
final class PlayerEvidenceFormattingSupport {
    private PlayerEvidenceFormattingSupport() {
    }

    static String damageActorText(final Battle battle,
                                  final PlayerResult player,
                                  final long recorderAccountId) {
        if (player == null) {
            return "未知玩家驾驶的未知坦克";
        }
        final String tank = ReplayDisplayNames.tankName(player.tankId, player.tankName);
        if (player.accountId == recorderAccountId) {
            return "你驾驶的" + tank;
        }
        final Side side = PlayerSideResolver.resolve(battle, player);
        final String sideText = switch (side) {
            case FRIENDLY -> "队友";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知阵营";
        };
        return sideText + "玩家" + PlayerResultFormat.quoteForPrompt(player.nickname)
                + "驾驶的" + tank;
    }

    static String structuredTankFacts(final long tankId) {
        return structuredTankFacts(tankId, null);
    }

    static String structuredTankFacts(final long tankId, final PlayerResult player) {
        final StringBuilder sb = new StringBuilder(24);
        EntityIdentityResolver.appendStructuredTankFacts(sb, tankId, player);
        return sb.toString();
    }
}
