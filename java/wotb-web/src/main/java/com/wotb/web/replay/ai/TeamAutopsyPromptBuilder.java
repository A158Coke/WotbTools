package com.wotb.web.replay.ai;

import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.replay.processing.FriendlyEnemyResult.Winner;
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
 * 不信任 LLM 返回的名称。settlement-only：LLM 判断的 confidence 仅 PARTIAL/UNKNOWN——
 * confidence/PARTIAL/UNKNOWN/settlement-only/规则候选/provenance、playerKey 与逐人贡献分类
 * 都是 internal structured contract，
 * {@link #renderSection} 用户可见渲染一律不暴露——无 standout 时整段为空，绝不输出 P1~P7。</p>
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
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final boolean observedDamagePartial) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append("=== 结果 ===\n");
        sb.append(winnerLabel(winner, teamLabel, battle, perspectiveTeam)).append('\n');
        if (winner != null && winner.source() != null) {
            sb.append("resultSource=").append(winner.source().name()).append('\n');
        }
        if (winner != null && winner.pointsDecided()) {
            // pointsDecided=true 已保证结束时刻双方均未全员阵亡（非全歼）：supremacy 点数胜负的结束方式
            // 只按「标准业务规则 + 时长」判定——时长<420s 为某一方达到 1000 分提前结束，时长≥420s 为
            // 时间耗尽；不使用任何点数字段断言。全歼获胜不属于点数胜负（pointsDecided=false，结果行不加结束方式后缀）。
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
            sb.append("    归因限制: earlyDeath/weakOutput 只是规则候选; 仅凭结算与死亡时间无法确定阵亡原因是"
                    + "站位失误/指挥问题/承担既定任务, 不得直接写成确定战术过错\n");
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
        // 身后血量/位置优势测量（确定性）：供战犯/MVP 判定综合位置测量参考（见规则 1）
        if (recon != null) {
            final String behindLine = RelativeDepthHpEvidence.renderTeamSection(
                    battle, recon, perspectiveTeam, observedDamagePartial);
            if (!behindLine.isEmpty()) {
                sb.append(behindLine);
            }
        }
        sb.append("\n请按输出契约给出 JSON。");
        return sb.toString();
    }

    /**
     * 把结构化结果渲染为追加到复盘尾部的中文段落（仅在有 standout 时）。
     * <p>{@code mvps} 与 {@code biggestLiabilities} 均为空时返回空串
     * （没有 standout 是合法结果，UI/主复盘已知胜负，不重复）；有 standout 时只输出
     * {@code ## 重点复查} / {@code ## 高贡献者} 两小块，每行 {@code nickname / tank：reason}。
     * playerKey（P1..P7）仅作内部 lookup，绝不进入用户正文；confidence/PARTIAL/UNKNOWN、
     * settlement-only/规则候选/provenance、逐人贡献分类都是 internal structured contract，
     * 用户可见渲染一律不暴露。</p>
     */
    static String renderSection(final TeamAutopsyResult result,
                                final List<TeamAutopsyStats> roster) {
        if (result == null
                || (result.biggestLiabilities().isEmpty() && result.mvps().isEmpty())) {
            return "";
        }
        final Map<String, TeamAutopsyStats> byKey = roster == null ? Map.of()
                : roster.stream().collect(Collectors.toMap(
                        TeamAutopsyStats::playerKey, Function.identity()));
        final StringBuilder sb = new StringBuilder(512);
        if (!result.biggestLiabilities().isEmpty()) {
            sb.append("\n\n## 重点复查\n\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.biggestLiabilities()) {
                sb.append(renderPlayer(v.playerKey(), byKey)).append("：")
                        .append(v.reason() == null ? "" : v.reason()).append('\n');
            }
        }
        if (!result.mvps().isEmpty()) {
            sb.append("\n\n## 高贡献者\n\n");
            for (final TeamAutopsyResult.AutopsyVerdict v : result.mvps()) {
                sb.append(renderPlayer(v.playerKey(), byKey)).append("：")
                        .append(v.reason() == null ? "" : v.reason()).append('\n');
            }
        }
        return sb.toString();
    }

    /** 按 playerKey 回查后端 roster 的权威昵称/坦克名；playerKey 仅作内部 lookup，绝不进入用户正文。 */
    private static String renderPlayer(final String playerKey,
                                       final Map<String, TeamAutopsyStats> byKey) {
        final TeamAutopsyStats stat = byKey.get(playerKey);
        if (stat == null) {
            return "未知玩家";
        }
        final String nickname = stat.nickname();
        final String tank = stat.tankName();
        final String label = !nickname.isBlank() && !tank.isBlank()
                ? nickname + " / " + tank
                : (!nickname.isBlank() ? nickname : tank);
        // 用户可见展示：昵称/坦克名来自回放数据，防换行注入；不暴露 playerKey。
        return label.replaceAll("[\\r\\n]", " ");
    }

    /** 团队赛胜负标签（battle 可用时附加全歼双向语义）：全歼敌方获胜 / 被敌方全歼落败。 */
    static String winnerLabel(final TeamBattleWinner winner, final String teamLabel,
                              final Battle battle, final int perspectiveTeam) {
        if (winner == null) {
            return "未知";
        }
        final String label = teamLabel == null || teamLabel.isBlank() ? "本方" : teamLabel;
        final String base = switch (winner.winner()) {
            case FRIENDLY_WIN -> label + "获胜";
            case ENEMY_WIN -> label + "落败";
            case DRAW_OR_UNKNOWN -> "未知";
        };
        // 全歼双向语义（结算存活状态，与 resultSource 无关）；battle 缺失时保持纯胜负标签。
        final String annihilation = com.wotb.core.replay.processing.FriendlyEnemyResult.annihilationSuffix(
                battle, perspectiveTeam, winner.winner());
        if (!annihilation.isEmpty()) {
            return base + annihilation;
        }
        if (!winner.pointsDecided()) {
            return base;
        }
        return switch (winner.pointsEndReason()) {
            case REACHED_1000 -> winner.winner() == Winner.DRAW_OR_UNKNOWN
                    ? base + "（某一方达到 1000 分导致提前结束，具体胜方未知）"
                    : base + "（达到 1000 分提前获胜）";
            case TIME_EXPIRED -> winner.winner() == Winner.DRAW_OR_UNKNOWN
                    ? base + "（时间耗尽点数判定，具体胜方未知）"
                    : base + "（时间耗尽点数判定）";
            case UNKNOWN, NOT_APPLICABLE -> base + "（点数判定）";
        };
    }

    /** 点数胜利的结束方式说明（供 prompt 使用；禁止 AI 把点数胜负写成常规胜利）。 */
    private static String pointsDecidedNote(final TeamBattleWinner winner) {
        return switch (winner.pointsEndReason()) {
            case TIME_EXPIRED -> "本局为时间耗尽点数判定（结束时刻双方均未全员阵亡，时长达到 7 分钟），"
                    + "叙述必须写「时间耗尽」；双方终局比分未解码，未知，不得编造精确比分；"
                    + "不要描述成敌方全歼。";
            case REACHED_1000 -> winner.winner() == Winner.DRAW_OR_UNKNOWN
                    ? "本局为某一方达到 1000 分导致提前结束（结束时刻双方均未全员阵亡，时长未到 7 分钟），"
                    + "具体胜方未知；叙述写「某一方达到 1000 分导致提前结束，具体胜方未知」，"
                    + "双方终局比分未知，不得把 1000 分分配给任何队伍；不要描述成敌方全歼。"
                    : "本局为任一方达到 1000 分提前获胜（结束时刻双方均未全员阵亡，时长未到 7 分钟），"
                    + "叙述必须写「达到 1000 分提前获胜」；不要描述成敌方全歼。"
                    + "争霸赛每击杀夺取对方 40 分、本方掉人损失 40 分（业务规则，仅作叙述口径，"
                    + "结算字段是否已含该调整未经证明）；只有权威胜方已知时胜利方终局比分才=1000"
                    + "（1000 分上限业务约定），失败方终局比分未知，不得编造；"
                    + "禁止把逐人占点分合计或任何公式计算结果冒充终局比分。";
            case UNKNOWN, NOT_APPLICABLE -> "本局为争霸赛点数判定（结束时刻双方均未全员阵亡），"
                    + "不要描述成敌方全歼；无法证明「达到 1000 分提前结束」或「时间耗尽」时只写「点数判定」，"
                    + "终局比分未知，不得编造。";
        };
    }
}
