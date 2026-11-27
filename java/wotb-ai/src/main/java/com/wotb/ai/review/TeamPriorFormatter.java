package com.wotb.ai.review;

import org.springframework.util.StringUtils;

import static com.wotb.ai.review.TeamEvidenceFormatter.quoteData;

final class TeamPriorFormatter {
    private TeamPriorFormatter() {
    }

    static String priorSection(final PreBattleStrategicPrior prior,
                                       final int perspectiveTeam,
                                       final String teamLabel) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("=== PRE-BATTLE STRATEGIC PRIOR（Call #1 赛前战略基线，仅基于地图与双方阵容，未读取任何战斗结果） ===\n");
        if (prior == null || !prior.hasContent()) {
            sb.append("（本次赛前战略基线不可用：Call #1 未产出有效结果）\n");
            return sb.toString();
        }
        final boolean swapped = perspectiveTeam == 2;
        final PreBattleStrategicPrior.TeamProfile teamAProfile = swapped
                ? prior.teamB() : prior.teamA();
        final PreBattleStrategicPrior.TeamProfile teamBProfile = swapped
                ? prior.teamA() : prior.teamB();
        final String teamALabel = "TEAM_A（你的队伍"
                + (StringUtils.hasText(teamLabel) ? " " + teamLabel : "") + "）";
        appendTeamProfile(sb, teamALabel, teamAProfile);
        appendTeamProfile(sb, "TEAM_B（对方队伍）", teamBProfile);
        if (!prior.keyMatchups().isEmpty()) {
            sb.append("\n关键对阵:\n");
            for (final PreBattleStrategicPrior.KeyMatchup m : prior.keyMatchups()) {
                sb.append("  - 区域 ").append(quoteData(m.area()))
                        .append(" | 优势 ").append(quoteData(swapped ? swapTeamToken(m.advantage()) : m.advantage()))
                        .append(" | ").append(quoteData(m.reason())).append('\n');
            }
        }
        if (!prior.strategicWinConditions().isEmpty()) {
            sb.append("\n战略胜机:\n");
            for (final PreBattleStrategicPrior.StrategicWinCondition w : prior.strategicWinConditions()) {
                sb.append("  - ").append(quoteData(swapped ? swapTeamToken(w.team()) : w.team()))
                        .append(": ").append(quoteData(w.condition())).append('\n');
            }
        }
        if (!prior.hypotheses().isEmpty()) {
            sb.append("\n战略假设（复盘对照：预期 vs 实际，考虑一波流等特殊战局）:\n");
            for (final PreBattleStrategicPrior.StrategicHypothesis h : prior.hypotheses()) {
                sb.append("  [").append(hypothesisIdLabel(h.id())).append("] ")
                        .append(quoteData(swapped ? swapTeamToken(h.claim()) : h.claim()))
                        .append("（理由: ").append(quoteData(swapped ? swapTeamToken(h.reason()) : h.reason()))
                        .append("）\n");
            }
        }
        return sb.toString();
    }

    static void appendTeamProfile(final StringBuilder sb,
                                          final String label,
                                          final PreBattleStrategicPrior.TeamProfile profile) {
        if (profile == null) {
            return;
        }
        sb.append('\n').append(label).append(":\n");
        if (!profile.strengths().isEmpty()) {
            sb.append("  优势: ").append(String.join("；", profile.strengths())).append('\n');
        }
        if (!profile.weaknesses().isEmpty()) {
            sb.append("  劣势: ").append(String.join("；", profile.weaknesses())).append('\n');
        }
        if (!profile.preferredPlans().isEmpty()) {
            sb.append("  预期最优打法（分阶段）: ").append(String.join("；", profile.preferredPlans())).append('\n');
        }
    }

    static String hypothesisIdLabel(final String id) {
        if (id == null) {
            return "H?";
        }
        final String sanitized = id.replaceAll("[\\[\\]\\n\\r]", " ").trim();
        return sanitized.isBlank() ? "H?" : sanitized;
    }

    static String swapTeamToken(final String text) {
        if (text == null || text.isBlank()) {
            return text == null ? "" : text;
        }
        return text.replace("TEAM_A", "\u0000A")
                .replace("TEAM_B", "TEAM_A")
                .replace("\u0000A", "TEAM_B");
    }
}
