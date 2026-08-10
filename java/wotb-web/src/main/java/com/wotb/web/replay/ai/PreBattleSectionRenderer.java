package com.wotb.web.replay.ai;

import org.springframework.util.StringUtils;

/**
 * Call #1（Pre-Battle Strategic Prior）的用户可见中文渲染器。
 * <p>与 Prompt 内的 priorSection 共享同一数据源（{@link PreBattleStrategicPrior}），
 * 但输出的是面向最终用户的 Markdown：去除机器段头（PRE-BATTLE STRATEGIC PRIOR）、
 * 内部标签（GRID_REGION_N 保留原文，TEAM_A/TEAM_B 替换为可读标签），只保留
 * 队伍画像 / 关键对阵 / 战略胜机 / 战略假设四个可读小节。</p>
 * <p>两种调用形态：随机战 harness 用中性标签（队伍1/队伍2）；团队复盘按视角
 * 队伍交换（我方/对方）。prior 不可用（Call #1 失败 / 降级 / 无内容）返回
 * {@code null}，由调用方置空 preBattleSection。</p>
 */
public final class PreBattleSectionRenderer {

    private PreBattleSectionRenderer() {
    }

    /** 随机战 harness：中性队伍标签（队伍1/队伍2），不做视角交换。 */
    public static String render(final PreBattleStrategicPrior prior) {
        return render(prior, 0, null);
    }

    /**
     * 团队复盘：按视角队伍交换，视角队伍渲染为「我方」，对手渲染为「对方」。
     *
     * @param perspectiveTeam 视角队伍（1 或 2；其他值按中性标签处理）
     * @param teamLabel       视角队伍的军团/队伍名（可空，仅用于增强可读性）
     */
    public static String render(final PreBattleStrategicPrior prior,
                                final int perspectiveTeam,
                                final String teamLabel) {
        if (prior == null || !prior.hasContent()) {
            return null;
        }
        final boolean teamView = perspectiveTeam == 1 || perspectiveTeam == 2;
        final boolean swapped = teamView && perspectiveTeam == 2;
        final String teamALabel = teamView
                ? "我方" + (StringUtils.hasText(teamLabel) ? "（" + teamLabel + "）" : "")
                : "队伍1";
        final String teamBLabel = teamView ? "对方" : "队伍2";
        // TEAM_A/TEAM_B 是 LLM 输出的原始队伍 token：不 swap 时 TEAM_A=渲染首位；
        // swap 后 TEAM_A 指向 prior.teamA（渲染末位），映射随之对调。
        final String tokenALabel = swapped ? teamBLabel : teamALabel;
        final String tokenBLabel = swapped ? teamALabel : teamBLabel;
        final PreBattleStrategicPrior.TeamProfile profileA = swapped ? prior.teamB() : prior.teamA();
        final PreBattleStrategicPrior.TeamProfile profileB = swapped ? prior.teamA() : prior.teamB();

        final StringBuilder sb = new StringBuilder(2048);
        sb.append("## 赛前预测\n\n");
        sb.append("基于地图与双方阵容的 AI 赛前判断（未读取任何战斗结果）。\n");
        appendTeamProfile(sb, teamALabel, profileA, tokenALabel, tokenBLabel);
        appendTeamProfile(sb, teamBLabel, profileB, tokenALabel, tokenBLabel);
        if (!prior.keyMatchups().isEmpty()) {
            sb.append("\n**关键对阵：**\n");
            for (final PreBattleStrategicPrior.KeyMatchup m : prior.keyMatchups()) {
                sb.append("- 区域 ").append(text(m.area(), "未知"));
                if (StringUtils.hasText(m.advantage())) {
                    sb.append("：").append(tokens(m.advantage(), tokenALabel, tokenBLabel));
                }
                if (StringUtils.hasText(m.reason())) {
                    sb.append("（").append(tokens(m.reason(), tokenALabel, tokenBLabel)).append("）");
                }
                sb.append('\n');
            }
        }
        if (!prior.strategicWinConditions().isEmpty()) {
            sb.append("\n**战略胜机：**\n");
            for (final PreBattleStrategicPrior.StrategicWinCondition w
                    : prior.strategicWinConditions()) {
                sb.append("- ").append(tokens(text(w.team(), "未知"), tokenALabel, tokenBLabel))
                        .append("：").append(text(w.condition(), "")).append('\n');
            }
        }
        if (!prior.hypotheses().isEmpty()) {
            sb.append("\n**战略假设：**\n");
            for (final PreBattleStrategicPrior.StrategicHypothesis h : prior.hypotheses()) {
                sb.append("- ").append("H").append(text(h.id(), "?"))
                        .append("：").append(tokens(text(h.claim(), ""), tokenALabel, tokenBLabel));
                if (StringUtils.hasText(h.reason())) {
                    sb.append("（理由：").append(tokens(h.reason(), tokenALabel, tokenBLabel)).append("）");
                }
                sb.append('\n');
            }
        }
        return sb.toString();
    }

    private static void appendTeamProfile(final StringBuilder sb,
                                          final String label,
                                          final PreBattleStrategicPrior.TeamProfile profile,
                                          final String tokenALabel,
                                          final String tokenBLabel) {
        if (profile == null) {
            return;
        }
        sb.append("\n**").append(label).append("画像：**\n");
        if (!profile.composition().isEmpty()) {
            sb.append("- 阵容属性：");
            sb.append(String.join("；", profile.composition().entrySet().stream()
                    .map(e -> e.getKey() + "=" + e.getValue())
                    .toList()));
            sb.append('\n');
        }
        if (!profile.strengths().isEmpty()) {
            sb.append("- 优势：")
                    .append(String.join("；", profile.strengths().stream()
                            .map(s -> tokens(s, tokenALabel, tokenBLabel))
                            .toList()))
                    .append('\n');
        }
        if (!profile.weaknesses().isEmpty()) {
            sb.append("- 劣势：")
                    .append(String.join("；", profile.weaknesses().stream()
                            .map(s -> tokens(s, tokenALabel, tokenBLabel))
                            .toList()))
                    .append('\n');
        }
        if (!profile.preferredPlans().isEmpty()) {
            sb.append("- 预期打法：")
                    .append(String.join("；", profile.preferredPlans().stream()
                            .map(s -> tokens(s, tokenALabel, tokenBLabel))
                            .toList()))
                    .append('\n');
        }
    }

    private static String text(final String value, final String fallback) {
        return StringUtils.hasText(value) ? value.trim() : fallback;
    }

    /**
     * 把 LLM 输出中的内部队伍 token 替换为用户可见标签。
     * 注意：{@code teamALabel} 是 TEAM_A token 对应的显示名、{@code teamBLabel}
     * 是 TEAM_B token 对应的显示名（调用侧已按视角 swap 映射）。
     */
    private static String tokens(final String text,
                                 final String teamALabel,
                                 final String teamBLabel) {
        return text.replace("TEAM_A", teamALabel).replace("TEAM_B", teamBLabel);
    }
}
