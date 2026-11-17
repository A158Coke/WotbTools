package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.ObservedMaxHp;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.util.PlayerResultFormat;

import java.util.List;

import static com.wotb.ai.review.TeamEvidenceFormatter.quoteData;

/** Team roster and member fact rendering. */
final class TeamRosterFormatter {
    private TeamRosterFormatter() {
    }

    static boolean appendOpposingTeam(
            final TeamPromptBudgetWriter writer,
            final Battle battle,
            final int perspectiveTeam
    ) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return false;
        }
        final List<PlayerResult> opponents = battle.players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team) && p.team != perspectiveTeam)
                .toList();
        if (opponents.isEmpty()) {
            return false;
        }
        writer.append("\n=== OPPOSING_TEAM_LINEUP_AUTHORITATIVE（对方阵容·权威结算） ===\n");
        int damage = 0;
        int received = 0;
        int assisted = 0;
        int blocked = 0;
        int kills = 0;
        int survivors = 0;
        for (final PlayerResult p : opponents) {
            writer.append("opponent accountId=" + p.accountId
                    + " nickname=" + quoteData(p.nickname)
                    + " tank=" + quoteData(resolveTankName(p.tankId, p.tankName))
                    + " vehicleClass=" + resolveTankClass(p.tankId)
                    + structuredTankFacts(p.tankId, p)
                    + " finalDamage=" + p.damageDealt
                    + " damageReceived=" + p.damageReceived
                    + " assisted=" + p.damageAssisted
                    + " blocked=" + p.damageBlocked
                    + " kills=" + p.kills
                    + " hits=" + p.nHitsDealt
                    + " penetrations=" + p.nPenetrationsDealt
                    + " enemiesDamaged=" + p.nEnemiesDamaged
                    + " death=" + PlayerAnalysisTerms.survivalDisplay(
                            p.survived, PlayerResultFormat.deathSec(p))
                    + "\n");
            damage += p.damageDealt;
            received += p.damageReceived;
            assisted += p.damageAssisted;
            blocked += p.damageBlocked;
            kills += p.kills;
            if (p.survived) survivors++;
        }
        writer.append("\n=== OPPOSING_TEAM_AUTHORITATIVE_RESULT（对方合计·权威结算） ===\n");
        writer.append("opponentCount=" + opponents.size()
                + " finalDamage=" + damage
                + " damageReceived=" + received
                + " assisted=" + assisted
                + " blocked=" + blocked
                + " kills=" + kills
                + " survivors=" + survivors
                + "\n");
        return true;
    }

    static String structuredTankFacts(final long tankId) {
        return structuredTankFacts(tankId, null);
    }

    /** 同上；hp 按 provenance 口径（OBSERVED_EXACT → 已证明进场满血；否则 tankopedia base）。 */
    static String structuredTankFacts(final long tankId, final PlayerResult player) {
        final StringBuilder sb = new StringBuilder(80);
        appendFact(sb, "tier", ReplayDisplayNames.tankTier(tankId));
        appendFact(sb, "nation", ReplayDisplayNames.tankNation(tankId));
        appendFact(sb, "alphaDamage", ReplayDisplayNames.tankAlphaDamage(tankId));
        final Integer maxHp = player == null
                ? ReplayDisplayNames.tankMaxHpValue(tankId) : ObservedMaxHp.fullMaxHp(player);
        appendFact(sb, "hp", maxHp != null && maxHp > 0
                ? String.valueOf(maxHp) : ReplayDisplayNames.tankMaxHp(tankId));
        sb.append(extraInfoFact(ReplayDisplayNames.tankExtraInfo(tankId)));
        return sb.toString();
    }

    static void appendFact(final StringBuilder sb, final String key, final String value) {
        if (!value.isEmpty()) {
            sb.append(' ').append(key).append('=').append(value);
        }
    }

    static String extraInfoFact(final String extraInfo) {
        return extraInfo.isEmpty() ? "" : " extraInfo=" + quoteData(extraInfo);
    }

    /**
         * 视角队伍的用户可见 display label：唯一 dominant 且严格多数
         * 的 clan tag，否则空串（上层 fallback「我方」）；绝不返回 {@code 队伍-XXXX}。
         */
    static String resolveDisplayLabel(
            final List<PlayerResult> players, final int perspectiveTeam) {
        if (players == null) return "";
        final List<PlayerResult> perspectivePlayers = players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "";
        return TeamPerspectiveLabelResolver.resolveDisplayLabel(perspectivePlayers);
    }

    /** 对方队伍的用户可见 display label（独立解析；无可靠 clan → 空串，上层 fallback「对方」）。 */
    static String resolveOpponentDisplayLabel(
            final List<PlayerResult> players, final int perspectiveTeam) {
        if (players == null) return "";
        final List<PlayerResult> opponents = players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team) && p.team != perspectiveTeam)
                .toList();
        if (opponents.isEmpty()) return "";
        return TeamPerspectiveLabelResolver.resolveDisplayLabel(opponents);
    }

    static String resolveTankName(final long tankId, final String existingTankName) {
        return ReplayDisplayNames.tankName(tankId, existingTankName);
    }

    static String resolveTankClass(final long tankId) {
        return ReplayDisplayNames.tankClass(tankId);
    }
}
