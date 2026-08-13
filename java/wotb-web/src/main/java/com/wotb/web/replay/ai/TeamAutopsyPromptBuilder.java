package com.wotb.web.replay.ai;

import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import com.wotb.core.util.PromptDataQuoter;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Team Autopsy（team perspective 结算级 TEAM_AUTOPSY）Prompt 构造与中文段落渲染。
 * <p>身份使用 playerKey（P1..P7）引用，nickname/tankName 只作展示；
 * 死亡时间线仅包含本方 TEAM_A 玩家；渲染时按 playerKey 回查后端 roster，
 * 不信任 LLM 返回的名称。settlement-only：LLM 判断的 confidence 仅 PARTIAL/UNKNOWN。</p>
 */
public final class TeamAutopsyPromptBuilder {

    private TeamAutopsyPromptBuilder() {
    }

    /**
     * 结算级 Team Autopsy（team perspective 使用）：无 Call #1 Strategic Prior、
     * 无 Critical Window、无 Route 证据，只基于权威逐人结算；置信度 PARTIAL/UNKNOWN。
     */
    static final String AUTOPSY_SYSTEM_PROMPT_SETTLEMENT_ONLY = AiPromptLibrary.zh("team/autopsy");

    static String buildUserContent(
            final List<TeamAutopsyStats> stats,
            final PreBattleStrategicPrior prior,
            final List<AiEvidence> criticalWindows,
            final TeamBattleWinner winner,
            final String teamLabel,
            final Battle battle,
            final int perspectiveTeam) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append("=== 结果 ===\n");
        sb.append(winnerLabel(winner, teamLabel, battle, perspectiveTeam)).append('\n');
        if (winner != null && winner.source() != null) {
            sb.append("resultSource=").append(winner.source().name()).append('\n');
        }
        if (winner != null && winner.pointsDecided()) {
            // pointsDecided=true 已保证结束时刻双方均未全员阵亡（非全歼）：supremacy 点数胜负只有
            // 两种结束方式——任一方达到 1000 分提前获胜，或时间耗尽后比较点数；双方均未达 1000 分时
            // 为时间耗尽。全歼获胜不属于点数胜负（pointsDecided=false，结果行不加结束方式后缀）。
            sb.append(pointsDecidedNote(winner)).append('\n');
        }
        sb.append("本方 7 人（TEAM_A）:\n");
        for (final TeamAutopsyStats s : stats) {
            sb.append("- ").append(s.playerKey()).append(" 昵称=")
                    .append(PromptDataQuoter.quote(
                            s.nickname().isBlank() ? "未知" : s.nickname(), "未知"))
                    .append(" 坦克=").append(PromptDataQuoter.quote(s.tankName(), "未知坦克"))
                    .append(' ').append(PromptDataQuoter.quote(s.tankClass(), "未知"))
                    .append(' ').append(s.tankTier().isBlank() ? "未知" : s.tankTier()).append("级")
                    .append(" | 输出").append(s.damageDealt())
                    .append(" 损失血量").append(s.damageReceived())
                    .append(" 助攻").append(s.damageAssisted())
                    .append(" 格挡").append(s.damageBlocked())
                    .append(" 击杀").append(s.kills())
                    .append(s.survived() ? " 存活"
                            : " 阵亡@" + PlayerAnalysisTerms.knownDeathClock(s.deathSec()))
                    .append('\n');
            sb.append("    flags: 早死=").append(s.earlyDeath())
                    .append("(规则候选,")
                    .append(PlayerAnalysisTerms.confidenceLabel(s.earlyDeathConfidence()))
                    .append(")")
                    .append(" 输出不足=").append(s.weakOutput())
                    .append("(规则候选,")
                    .append(PlayerAnalysisTerms.confidenceLabel(s.weakOutputConfidence()))
                    .append(")")
                    .append(" 窗口内阵亡=").append(s.deathInCriticalWindow())
                    .append("(")
                    .append(PlayerAnalysisTerms.confidenceLabel(s.deathInWindowConfidence()))
                    .append(")")
                    .append(" 结算级代理=").append(s.settlementOnly())
                    .append('\n');
        }
        if (prior != null && prior.teamA() != null) {
            sb.append("\n赛前职责基线（Call #1 Strategic Prior，TEAM_A）:\n");
            if (!prior.teamA().strengths().isEmpty()) {
                sb.append("  优势: ").append(String.join("；", prior.teamA().strengths())).append('\n');
            }
            if (!prior.teamA().preferredPlans().isEmpty()) {
                sb.append("  首选方案: ").append(String.join("；", prior.teamA().preferredPlans())).append('\n');
            }
            if (!prior.hypotheses().isEmpty()) {
                sb.append("  战略假设: ").append(String.join("；",
                        prior.hypotheses().stream().map(h -> h.id() + " " + h.claim()).toList())).append('\n');
            }
        }
        if (criticalWindows != null && !criticalWindows.isEmpty()) {
            sb.append("\n关键窗口（Backend 证据）:\n");
            for (final AiEvidence w : criticalWindows) {
                sb.append("- ").append(PlayerAnalysisTerms.battleRange(w.startSec(), w.endSec()))
                        .append(' ').append(w.summary()).append('\n');
            }
        }
        sb.append("\n死亡时间线（后端时间线，仅本方 TEAM_A）:\n");
        stats.stream()
                .filter(s -> !s.survived())
                // 未知死亡时间（deathSec<=0）排到已知时间之后，绝不因 0 被排到整场最前
                .sorted(java.util.Comparator
                        .comparingDouble((TeamAutopsyStats s) -> s.deathSec() > 0
                                ? s.deathSec() : Double.MAX_VALUE)
                        .thenComparing(TeamAutopsyStats::playerKey))
                .forEach(s -> sb.append("- ")
                        .append(s.deathSec() > 0
                                ? PlayerAnalysisTerms.battleClock((float) s.deathSec()) : "未知")
                        .append(' ').append(s.playerKey()).append(' ')
                        .append(PromptDataQuoter.quote(s.tankName(), "未知坦克"))
                        .append(s.deathSec() > 0 ? "" : "（时刻未知）")
                        .append('\n'));
        sb.append("\n请按输出契约给出 JSON。");
        return sb.toString();
    }

    /** 把结构化结果渲染为追加到复盘尾部的中文「团队剖析」段；按 playerKey 回查 roster。 */
    static String renderSection(final TeamAutopsyResult result,
                                final TeamBattleWinner winner,
                                final List<TeamAutopsyStats> roster,
                                final String teamLabel,
                                final Battle battle,
                                final int perspectiveTeam) {
        if (result == null) {
            return "";
        }
        final Map<String, TeamAutopsyStats> byKey = roster == null ? Map.of()
                : roster.stream().collect(Collectors.toMap(
                        TeamAutopsyStats::playerKey, Function.identity()));
        final StringBuilder sb = new StringBuilder(1024);
        sb.append("\n\n======================== 团队剖析 ========================\n");
        sb.append("胜负: ").append(winnerLabel(winner, teamLabel, battle, perspectiveTeam)).append('\n');
        if (!result.biggestLiabilities().isEmpty()) {
            sb.append("**主要战犯：**\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.biggestLiabilities()) {
                sb.append("- **").append(renderPlayer(v.playerKey(), byKey)).append("**")
                        .append("（置信度: ")
                        .append(confidenceLabel(v.confidence()))
                        .append("）: ").append(v.reason() == null ? "" : v.reason()).append('\n');
                if (v.evidence() != null && !v.evidence().isEmpty()) {
                    sb.append("    证据: ").append(String.join("；", v.evidence())).append('\n');
                }
            }
        }
        if (!result.mvps().isEmpty()) {
            sb.append("**MVP：**\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.mvps()) {
                sb.append("- **").append(renderPlayer(v.playerKey(), byKey)).append("**")
                        .append("（置信度: ")
                        .append(confidenceLabel(v.confidence()))
                        .append("）: ").append(v.reason() == null ? "" : v.reason()).append('\n');
                if (v.evidence() != null && !v.evidence().isEmpty()) {
                    sb.append("    证据: ").append(String.join("；", v.evidence())).append('\n');
                }
            }
        }
        if (!result.players().isEmpty()) {
            sb.append("逐人贡献:\n");
            for (final TeamAutopsyResult.AutopsyPlayer p : result.players()) {
                sb.append("- ").append(renderPlayer(p.playerKey(), byKey))
                        .append(": ")
                        .append(contributionLabel(p.contribution()))
                        .append("（")
                        .append(confidenceLabel(p.confidence()))
                        .append("）\n");
            }
        }
        return sb.toString();
    }

    /** 按 playerKey 回查后端 roster 的权威昵称/坦克名，不信任 LLM 返回的名称。 */
    private static String renderPlayer(final String playerKey,
                                       final Map<String, TeamAutopsyStats> byKey) {
        final TeamAutopsyStats stat = byKey.get(playerKey);
        if (stat == null) {
            return PromptDataQuoter.quote(playerKey, "未知玩家");
        }
        final String label = stat.nickname().isBlank()
                ? stat.tankName() : stat.nickname() + " / " + stat.tankName();
        return playerKey + "（" + PromptDataQuoter.quote(label, stat.tankName()) + "）";
    }

    /** 团队赛胜负标签（battle 可用时附加全歼双向语义）：全歼敌方获胜 / 被敌方全歼落败。 */
    static String winnerLabel(final TeamBattleWinner winner, final String teamLabel,
                              final Battle battle, final int perspectiveTeam) {
        if (winner == null) {
            return "未知";
        }
        final String label = teamLabel == null || teamLabel.isBlank() ? "TEAM_A" : teamLabel;
        final String base = switch (winner.winner()) {
            case FRIENDLY_WIN -> label + "获胜";
            case ENEMY_WIN -> label + "落败";
            case DRAW_OR_UNKNOWN -> "未知";
        };
        // 全歼双向语义（结算存活状态，与 resultSource 无关）；battle 缺失时保持纯胜负标签。
        final String annihilation = com.wotb.core.processing.FriendlyEnemyResult.annihilationSuffix(
                battle, perspectiveTeam, winner.winner());
        if (!annihilation.isEmpty()) {
            return base + annihilation;
        }
        if (!winner.pointsDecided()) {
            return base;
        }
        return switch (winner.pointsEndReason()) {
            case REACHED_1000 -> base + "（达到 1000 分提前获胜）";
            case TIME_EXPIRED -> base + "（时间耗尽点数判定）";
            case UNKNOWN, NOT_APPLICABLE -> base + "（点数判定）";
        };
    }

    /** 点数胜利的结束方式说明（供 prompt 使用；禁止 AI 把点数胜负写成常规胜利）。 */
    private static String pointsDecidedNote(final TeamBattleWinner winner) {
        return switch (winner.pointsEndReason()) {
            case TIME_EXPIRED -> "本局为时间耗尽点数胜利（结束时刻双方均未全员阵亡，且双方均未达 1000 分），"
                    + "叙述必须写「时间耗尽」；不要描述成敌方全歼。";
            case REACHED_1000 -> "本局为任一方达到 1000 分提前获胜（结束时刻双方均未全员阵亡），"
                    + "叙述必须写「达到 1000 分提前获胜」；不要描述成敌方全歼。";
            case UNKNOWN, NOT_APPLICABLE -> "本局为争霸赛点数胜利（结束时刻双方均未全员阵亡），"
                    + "不要描述成敌方全歼。";
        };
    }

    /** 渲染层中文映射：LLM JSON 契约保持英文枚举，仅展示时翻译（MVP 保留英文）。 */
    static String confidenceLabel(final String confidence) {
        if (confidence == null) {
            return "未知";
        }
        return switch (confidence.toUpperCase(java.util.Locale.ROOT)) {
            case "EXACT" -> "精确";
            case "INFERRED" -> "推断";
            case "PARTIAL" -> "部分";
            default -> "未知";
        };
    }

    static String contributionLabel(final String contribution) {
        if (contribution == null) {
            return "未知";
        }
        return switch (contribution.toUpperCase(java.util.Locale.ROOT)) {
            case "HIGH" -> "高";
            case "MEDIUM" -> "中";
            case "LOW" -> "低";
            default -> "未知";
        };
    }
}
