package com.wotb.web.replay.ai;

import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
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
    static final String AUTOPSY_SYSTEM_PROMPT_SETTLEMENT_ONLY = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在对录像者所在队伍（TEAM_A）做结算级团队剖析。
            本分析在赛后进行，可以看到最终结果，但必须遵守以下规则：

            === 强制规则 ===
            1. 严禁事后诸葛亮：每一条结论必须引用下方权威结算数据，不能仅因"输/赢"倒推谁背锅或谁最佳。
            2. 判负：biggestLiabilities（战犯）必须至少 1 条，可多人（建议 ≤3）；判胜：mvps 必须至少 1 条。
               同一人可同时出现在两类中（需说明）。
            3. 本输入是结算级数据：没有关键窗口、没有赛前职责基线、没有逐人 Route/走位证据。
               战犯证据类别仅限：损失血量明显偏高且与车型职责/存活时长/输出不匹配
               （薄皮输出车无价值掉血、过早阵亡前的大量掉血；重坦抗线掉血不直接作为战犯依据）、
               过早阵亡（阵亡时刻显著早于合理线）、缺乏输出（输出车 damageDealt 显著低于本方均值/职责期望）。
               严格区分「损失血量」与「格挡伤害」：格挡伤害越高越好，损失血量本身中性，评价必须结合车型与场景。
            4. 所有玩家都是结算级代理：无逐人窗口证据，任何窗口类/精确归因结论置信度必须 PARTIAL 或 UNKNOWN，
               不得声称精确归因。
            5. 措辞中性：用"主要负面贡献者（战犯）"表达，禁止情绪化、人身化、侮辱性语言。
            6. 权威层级：Battle Result > 你的判断；未提供信息一律写"未知"。
            7. 玩家身份必须使用下方 roster 中的 playerKey（P1~P7）引用，禁止用昵称或坦克名称做身份键；
               昵称/坦克名只是展示信息，不得作为输出引用。
            8. 只输出一个合法 JSON 对象，不要输出任何其他文字、解释或 markdown 代码围栏。

            === 输出 JSON 契约 ===
            {
              "players": [
                { "playerKey": "P1", "contribution": "HIGH|MEDIUM|LOW|UNKNOWN", "confidence": "PARTIAL|UNKNOWN" }
              ],
              "mvps": [
                { "playerKey": "P1", "reason": "≤80字", "evidence": ["≤60字"], "confidence": "PARTIAL|UNKNOWN" }
              ],
              "biggestLiabilities": [
                { "playerKey": "P1", "reason": "≤80字", "evidence": ["≤60字"], "confidence": "PARTIAL|UNKNOWN" }
              ],
              "limitations": ["≤60字"]
            }
            要求：players 覆盖下方名单全部玩家且 playerKey 必须来自名单；mvps ≤3；biggestLiabilities ≤3；
            每条 verdict 至少 1 条 evidence 且 playerKey 有效；confidence 只能写 PARTIAL 或 UNKNOWN，
            结算级评估不得使用 EXACT/INFERRED。""" + PlayerReplayPromptBuilder.COMMON_DAMAGE_SEMANTICS_RULE;

    static String buildUserContent(
            final List<TeamAutopsyStats> stats,
            final PreBattleStrategicPrior prior,
            final List<AiEvidence> criticalWindows,
            final TeamBattleWinner winner,
            final String teamLabel) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append("=== 结果 ===\n");
        sb.append(winnerLabel(winner, teamLabel)).append('\n');
        if (winner != null && winner.pointsDecided()) {
            sb.append("本局为争霸赛点数胜利（结束时刻双方均未全员阵亡），"
                    + "不要描述成敌方全歼。\n");
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
                            : " 阵亡@" + PlayerAnalysisTerms.battleClock((float) s.deathSec()))
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
                .sorted(java.util.Comparator.comparingDouble(TeamAutopsyStats::deathSec))
                .forEach(s -> sb.append("- ")
                        .append(PlayerAnalysisTerms.battleClock((float) s.deathSec()))
                        .append(' ').append(s.playerKey()).append(' ')
                        .append(PromptDataQuoter.quote(s.tankName(), "未知坦克"))
                        .append('\n'));
        sb.append("\n请按输出契约给出 JSON。");
        return sb.toString();
    }

    /** 把结构化结果渲染为追加到复盘尾部的中文「团队剖析」段；按 playerKey 回查 roster。 */
    static String renderSection(final TeamAutopsyResult result,
                                final TeamBattleWinner winner,
                                final List<TeamAutopsyStats> roster,
                                final String teamLabel) {
        if (result == null) {
            return "";
        }
        final Map<String, TeamAutopsyStats> byKey = roster == null ? Map.of()
                : roster.stream().collect(Collectors.toMap(
                        TeamAutopsyStats::playerKey, Function.identity()));
        final StringBuilder sb = new StringBuilder(1024);
        sb.append("\n\n======================== 团队剖析 ========================\n");
        sb.append("胜负: ").append(winnerLabel(winner, teamLabel)).append('\n');
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

    /** 团队赛胜负标签；使用实际队名（teamLabel），点数判定时附加说明。 */
    static String winnerLabel(final TeamBattleWinner winner, final String teamLabel) {
        if (winner == null) {
            return "未知";
        }
        final String label = teamLabel == null || teamLabel.isBlank() ? "TEAM_A" : teamLabel;
        final String base = switch (winner.winner()) {
            case FRIENDLY_WIN -> label + "获胜";
            case ENEMY_WIN -> label + "落败";
            case DRAW_OR_UNKNOWN -> "未知";
        };
        return winner.pointsDecided() ? base + "（点数判定）" : base;
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
