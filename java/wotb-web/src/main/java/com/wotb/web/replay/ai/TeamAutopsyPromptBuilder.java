package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import com.wotb.core.util.PromptDataQuoter;

import java.util.List;

/**
 * Team Autopsy（第 3 次调用）Prompt 构造与中文段落渲染。
 * <p>职责：只输入赛前职责基线 + 7 人确定性数据 + 关键窗口 + 死亡时间线，
 * 让 LLM 做跨玩家贡献归因（判负 → 战犯，判胜 → MVP），输出严格 JSON。</p>
 */
public final class TeamAutopsyPromptBuilder {

    private TeamAutopsyPromptBuilder() {
    }

    static final String AUTOPSY_SYSTEM_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在对录像者所在队伍的 7 人做赛后团队剖析。
            本分析在赛后进行，可以看到最终结果，但必须遵守以下规则：

            === 强制规则 ===
            1. 严禁事后诸葛亮：每一条结论必须引用下方结算/窗口/时间证据，不能仅因"输/赢"倒推谁背锅或谁最佳。
            2. 判负：biggestLiabilities（战犯）必须至少 1 条，可多人（建议 ≤3）；判胜：mvps 必须至少 1 条。
               同一人可同时出现在两类中（需说明）。
            3. 战犯证据类别（V1）：
               - 短窗口掉血过多（damageReceived 集中于关键窗口）；
               - 过早阵亡（输出车 / 中轻坦等职责车种阵亡时间显著早于合理线）；
               - 缺乏输出（输出车 damageDealt 显著低于全队/职责期望）；
               - 脱节（仅录像者有 Route 数据；其余玩家该项不可用）。
            4. 非录像者玩家没有逐人窗口证据，标记"结算级代理"的玩家其窗口类判断只能基于承伤/早死/窗口内阵亡近似，
               相关结论置信度必须 PARTIAL 或 UNKNOWN，不得声称精确归因。
            5. 措辞中性：用"主要负面贡献者（战犯）"表达，禁止情绪化、人身化、侮辱性语言。
            6. 权威层级：Battle Result > 事件流 > 状态重建 > Backend Skill > 你的判断；未提供信息一律写"未知"。
            7. 坦克名称必须原样使用下方提供的名称，禁止改写、翻译或缩写。
            8. 只输出一个合法 JSON 对象，不要输出任何其他文字、解释或 markdown 代码围栏。

            === 输出 JSON 契约 ===
            {
              "players": [
                { "tank": "名称", "contribution": "HIGH|MEDIUM|LOW|UNKNOWN", "confidence": "EXACT|INFERRED|PARTIAL|UNKNOWN" }
              ],
              "mvps": [
                { "tank": "名称", "reason": "≤80字", "evidence": ["≤60字"], "confidence": "..." }
              ],
              "biggestLiabilities": [
                { "tank": "名称", "reason": "≤80字", "evidence": ["≤60字"], "confidence": "..." }
              ],
              "limitations": ["≤60字"]
            }
            要求：players 覆盖全部 7 人；mvps ≤3；biggestLiabilities ≤3；每条 verdict 至少 1 条 evidence。""";

    static String buildUserContent(
            final Battle battle,
            final List<TeamAutopsyStats> stats,
            final PreBattleStrategicPrior prior,
            final List<AiEvidence> criticalWindows,
            final Winner winner) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append("=== 结果 ===\n");
        sb.append(winnerLabel(winner)).append('\n');
        sb.append("本方 7 人（TEAM_A / 队伍1）:\n");
        for (final TeamAutopsyStats s : stats) {
            sb.append("- ").append(PromptDataQuoter.quote(s.tankName(), "未知坦克"))
                    .append(' ').append(PromptDataQuoter.quote(s.tankClass(), "未知"))
                    .append(' ').append(s.tankTier().isBlank() ? "未知" : s.tankTier()).append("级")
                    .append(" | 输出").append(s.damageDealt())
                    .append(" 承伤").append(s.damageReceived())
                    .append(" 助攻").append(s.damageAssisted())
                    .append(" 格挡").append(s.damageBlocked())
                    .append(" 击杀").append(s.kills())
                    .append(s.survived() ? " 存活" : " 阵亡@" + PlayerAnalysisTerms.battleClock((float) s.deathSec()))
                    .append('\n');
            sb.append("    flags: 早死=").append(s.earlyDeath())
                    .append(" 输出不足=").append(s.weakOutput())
                    .append(" 窗口内阵亡=").append(s.deathInCriticalWindow())
                    .append(" 结算级代理=").append(s.settlementOnly())
                    .append(" 置信度=").append(PlayerAnalysisTerms.confidenceLabel(s.confidence()))
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
        sb.append("\n死亡时间线（权威结算）:\n");
        battle.players.stream()
                .filter(p -> !p.survived)
                .sorted(java.util.Comparator.comparingDouble(com.wotb.core.util.PlayerResultFormat::deathSec))
                .forEach(p -> sb.append("- ").append(PlayerAnalysisTerms.battleClock(
                        (float) com.wotb.core.util.PlayerResultFormat.deathSec(p)))
                        .append(' ').append(PromptDataQuoter.quote(
                                ReplayDisplayNames.tankName(p.tankId, p.tankName), "未知坦克"))
                        .append('\n'));
        sb.append("\n请按输出契约给出 JSON。");
        return sb.toString();
    }

    /** 把结构化结果渲染为追加到复盘尾部的中文「团队剖析」段。 */
    static String renderSection(final TeamAutopsyResult result, final Winner winner) {
        if (result == null) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(1024);
        sb.append("\n\n======================== 团队剖析 ========================\n");
        sb.append("胜负: ").append(winnerLabel(winner)).append('\n');
        if (!result.biggestLiabilities().isEmpty()) {
            sb.append("主要战犯:\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.biggestLiabilities()) {
                sb.append("- ").append(PromptDataQuoter.quote(v.tank(), "未知坦克"))
                        .append("（置信度: ").append(v.confidence() == null ? "未知" : v.confidence()).append("）: ")
                        .append(v.reason() == null ? "" : v.reason()).append('\n');
                if (v.evidence() != null && !v.evidence().isEmpty()) {
                    sb.append("    证据: ").append(String.join("；", v.evidence())).append('\n');
                }
            }
        }
        if (!result.mvps().isEmpty()) {
            sb.append("MVP:\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.mvps()) {
                sb.append("- ").append(PromptDataQuoter.quote(v.tank(), "未知坦克"))
                        .append("（置信度: ").append(v.confidence() == null ? "未知" : v.confidence()).append("）: ")
                        .append(v.reason() == null ? "" : v.reason()).append('\n');
                if (v.evidence() != null && !v.evidence().isEmpty()) {
                    sb.append("    证据: ").append(String.join("；", v.evidence())).append('\n');
                }
            }
        }
        if (!result.players().isEmpty()) {
            sb.append("逐人贡献:\n");
            for (final TeamAutopsyResult.AutopsyPlayer p : result.players()) {
                sb.append("- ").append(PromptDataQuoter.quote(p.tank(), "未知坦克"))
                        .append(": ").append(p.contribution() == null ? "UNKNOWN" : p.contribution())
                        .append("（").append(p.confidence() == null ? "未知" : p.confidence()).append("）\n");
            }
        }
        if (!result.limitations().isEmpty()) {
            sb.append("限制:\n");
            result.limitations().forEach(l -> sb.append("- ").append(l).append('\n'));
        }
        return sb.toString();
    }

    static String winnerLabel(final Winner winner) {
        return switch (winner) {
            case FRIENDLY_WIN -> "判胜（TEAM_A / 队伍1）";
            case ENEMY_WIN -> "判负（TEAM_A / 队伍1）";
            case DRAW_OR_UNKNOWN -> "未知";
        };
    }
}
