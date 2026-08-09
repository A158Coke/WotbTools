package com.wotb.web.replay.ai;

import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import com.wotb.core.util.PromptDataQuoter;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Team Autopsy（第 3 次调用）Prompt 构造与中文段落渲染。
 * <p>身份使用 playerKey（P1..P7）引用，nickname/tankName 只作展示；
 * 死亡时间线仅包含本方 TEAM_A 玩家；渲染时按 playerKey 回查后端 roster，
 * 不信任 LLM 返回的名称。</p>
 */
public final class TeamAutopsyPromptBuilder {

    private TeamAutopsyPromptBuilder() {
    }

    static final String AUTOPSY_SYSTEM_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在对录像者所在队伍（TEAM_A）的 7 人做赛后团队剖析。
            本分析在赛后进行，可以看到最终结果，但必须遵守以下规则：

            === 强制规则 ===
            1. 严禁事后诸葛亮：每一条结论必须引用下方结算/窗口/时间证据，不能仅因"输/赢"倒推谁背锅或谁最佳。
            2. 判负：biggestLiabilities（战犯）必须至少 1 条，可多人（建议 ≤3）；判胜：mvps 必须至少 1 条。
               同一人可同时出现在两类中（需说明）。
            3. 战犯证据类别（V1）：
               - 短窗口掉血过多（damageReceived 集中于关键窗口）；
               - 过早阵亡（输出车 / 中轻坦等职责车种阵亡时间显著早于合理线）；
               - 缺乏输出（输出车 damageDealt 显著低于本方/职责期望）；
               - 脱节（仅录像者有 Route 数据；其余玩家该项不可用）。
            4. 非录像者玩家没有逐人窗口证据，标记"结算级代理"的玩家其窗口类判断只能基于承伤/早死/窗口内阵亡近似，
               相关结论置信度必须 PARTIAL 或 UNKNOWN，不得声称精确归因。
            5. 措辞中性：用"主要负面贡献者（战犯）"表达，禁止情绪化、人身化、侮辱性语言。
            6. 权威层级：Battle Result > 事件流 > 状态重建 > Backend Skill > 你的判断；未提供信息一律写"未知"。
            7. 玩家身份必须使用下方 roster 中的 playerKey（P1~P7）引用，禁止用昵称或坦克名称做身份键；
               昵称/坦克名只是展示信息，不得作为输出引用。
            8. 只输出一个合法 JSON 对象，不要输出任何其他文字、解释或 markdown 代码围栏。

            === 输出 JSON 契约 ===
            {
              "players": [
                { "playerKey": "P1", "contribution": "HIGH|MEDIUM|LOW|UNKNOWN", "confidence": "EXACT|INFERRED|PARTIAL|UNKNOWN" }
              ],
              "mvps": [
                { "playerKey": "P1", "reason": "≤80字", "evidence": ["≤60字"], "confidence": "..." }
              ],
              "biggestLiabilities": [
                { "playerKey": "P1", "reason": "≤80字", "evidence": ["≤60字"], "confidence": "..." }
              ],
              "limitations": ["≤60字"]
            }
            要求：players 覆盖全部 7 人且 playerKey 必须来自下方名单；mvps ≤3；biggestLiabilities ≤3；
            每条 verdict 至少 1 条 evidence 且 playerKey 有效。""";

    static String buildUserContent(
            final List<TeamAutopsyStats> stats,
            final PreBattleStrategicPrior prior,
            final List<AiEvidence> criticalWindows,
            final Winner winner) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append("=== 结果 ===\n");
        sb.append(winnerLabel(winner)).append('\n');
        sb.append("本方 7 人（TEAM_A）:\n");
        for (final TeamAutopsyStats s : stats) {
            sb.append("- ").append(s.playerKey()).append(" 昵称=")
                    .append(PromptDataQuoter.quote(
                            s.nickname().isBlank() ? "未知" : s.nickname(), "未知"))
                    .append(" 坦克=").append(PromptDataQuoter.quote(s.tankName(), "未知坦克"))
                    .append(' ').append(PromptDataQuoter.quote(s.tankClass(), "未知"))
                    .append(' ').append(s.tankTier().isBlank() ? "未知" : s.tankTier()).append("级")
                    .append(" | 输出").append(s.damageDealt())
                    .append(" 承伤").append(s.damageReceived())
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
        sb.append("\n死亡时间线（权威结算，仅本方 TEAM_A）:\n");
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
                                final Winner winner,
                                final List<TeamAutopsyStats> roster) {
        if (result == null) {
            return "";
        }
        final Map<String, TeamAutopsyStats> byKey = roster == null ? Map.of()
                : roster.stream().collect(Collectors.toMap(
                        TeamAutopsyStats::playerKey, Function.identity()));
        final StringBuilder sb = new StringBuilder(1024);
        sb.append("\n\n======================== 团队剖析 ========================\n");
        sb.append("胜负: ").append(winnerLabel(winner)).append('\n');
        if (!result.biggestLiabilities().isEmpty()) {
            sb.append("主要战犯:\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.biggestLiabilities()) {
                sb.append("- ").append(renderPlayer(v.playerKey(), byKey))
                        .append("（置信度: ")
                        .append(v.confidence() == null ? "未知" : v.confidence())
                        .append("）: ").append(v.reason() == null ? "" : v.reason()).append('\n');
                if (v.evidence() != null && !v.evidence().isEmpty()) {
                    sb.append("    证据: ").append(String.join("；", v.evidence())).append('\n');
                }
            }
        }
        if (!result.mvps().isEmpty()) {
            sb.append("MVP:\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.mvps()) {
                sb.append("- ").append(renderPlayer(v.playerKey(), byKey))
                        .append("（置信度: ")
                        .append(v.confidence() == null ? "未知" : v.confidence())
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
                        .append(p.contribution() == null ? "UNKNOWN" : p.contribution())
                        .append("（")
                        .append(p.confidence() == null ? "未知" : p.confidence())
                        .append("）\n");
            }
        }
        if (!result.limitations().isEmpty()) {
            sb.append("限制:\n");
            result.limitations().forEach(l -> sb.append("- ").append(l).append('\n'));
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

    static String winnerLabel(final Winner winner) {
        return switch (winner) {
            case FRIENDLY_WIN -> "判胜（TEAM_A）";
            case ENEMY_WIN -> "判负（TEAM_A）";
            case DRAW_OR_UNKNOWN -> "未知";
        };
    }
}
