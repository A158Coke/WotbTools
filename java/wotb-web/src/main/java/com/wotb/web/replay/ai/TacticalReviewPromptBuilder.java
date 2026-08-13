package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.evidence.EvidenceType;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.core.util.PromptDataQuoter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Call #2（Tactical Review）Priority Bookends Prompt 构造器（文档 §20-§22）。
 * <p>前部建立注意力索引（TOP PIVOTAL WINDOWS），尾部提供完整关键窗口证据
 * （Controlled Redundancy）；预算不足时按相关性从低到高裁剪，保证
 * SNAPSHOT / PRIOR / TASK 三个书签段始终完整。</p>
 */
public final class TacticalReviewPromptBuilder {

    // 940k input budget 下窗口上限可以远高于 3：把关键决策窗口/对炮明细尽量喂全，
    // 由 effectiveLimit 兜底裁剪（实际用量远低于预算时不会触发）。
    static final int MAX_TOP_WINDOWS = 8;
    static final int MAX_WINDOW_DETAIL = 8;



    static final String TACTICAL_SYSTEM_PROMPT = AiPromptLibrary.zh("player/tactical");

    private TacticalReviewPromptBuilder() {
    }

    /** 最终产物：system + user（含裁剪状态）。 */
    public record PreparedHarnessPrompt(
            String systemPrompt,
            String userContent,
            int estimatedInputTokens,
            boolean truncated,
            String budgetSummary
    ) {
    }

    public static PreparedHarnessPrompt prepare(
            final PreBattleStrategicPrior prior,
            final EvidenceSkillResult evidence,
            final Battle battle,
            final ReplayReconstruction recon,
            final PlayerBattleFeatureSet features,
            final RecorderEntityMapping recorder,
            final AiTokenEstimator estimator,
            final int singleReplayMaxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens
    ) {
        final StringBuilder sb = new StringBuilder(8192);
        sb.append(snapshot(battle, recon, features, recorder));
        sb.append("\n\n").append(priorSection(prior));

        final String baseContent = sb.toString();
        final List<AiEvidence> rawEvidence = evidence != null ? evidence.evidence() : List.of();
        final List<AiEvidence> rawWindows = evidence != null ? evidence.criticalWindows() : List.of();
        // 录像者掉血窗口：与 fallback 同格式/同口径；OBSERVED_DAMAGE_IS_PARTIAL 时抑制数字
        final boolean damagePartial = features != null && features.limitations() != null
                && features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
        // 覆盖不全时防御性过滤：换血（ENGAGEMENT_TRADE）的摘要/数字与依赖它们的窗口
        // 一律不得进入 LLM（即使调用方传入未过滤的 EvidenceSkillResult）。
        final List<AiEvidence> evidenceForPrompt = damagePartial
                ? rawEvidence.stream()
                        .filter(e -> e.type() != EvidenceType.ENGAGEMENT_TRADE)
                        .toList()
                : rawEvidence;
        final List<AiEvidence> windows = damagePartial
                ? rawWindows.stream()
                        .filter(w -> !windowCarriesTradeDamage(w))
                        .toList()
                : rawWindows;
        int windowDetail = Math.min(MAX_WINDOW_DETAIL, windows.size());
        boolean includeEvidence = !evidenceForPrompt.isEmpty();
        boolean includeEngagements = features != null
                && features.engagements() != null && !features.engagements().isEmpty();
        final String enemyPositionsSection =
                EnemyLastKnownPositionsSection.renderPlayerSection(battle, recon);
        boolean includeEnemyPositions = !enemyPositionsSection.isEmpty();
        // 覆盖不全时逐条交火数字同样是事件流伤害数字：一并抑制（与 fallback 交火段口径一致）
        if (damagePartial) {
            includeEngagements = false;
        }
        final String damageWindowsSection = recorder != null && recorder.accountId() != null
                ? PlayerEvidenceFormatter.recorderDamageReceivedWindowsSection(
                        battle, recon, recorder.accountId(), damagePartial)
                : "";
        boolean includeDamageWindows = !damageWindowsSection.isEmpty();
        boolean includePhases = features != null && features.phases() != null && !features.phases().isEmpty();
        boolean includeTop = !windows.isEmpty();
        boolean includeWindowDetail = !windows.isEmpty();

        final int effectiveLimit = Math.clamp(
                contextWindowTokens - maxOutputTokens - promptSafetyMarginTokens,
                0, singleReplayMaxInputTokens);

        String content = assemble(baseContent, evidenceForPrompt, features, windows,
                windowDetail, includeEvidence, includeEngagements,
                includeEnemyPositions, enemyPositionsSection,
                includeDamageWindows, damageWindowsSection,
                includePhases, includeTop, includeWindowDetail, battle);
        int estimated = estimate(estimator, TACTICAL_SYSTEM_PROMPT, content);
        boolean truncated = false;

        // 相关性裁剪阶梯：先删细节，再删整段，最后删索引；书签段永不裁剪
        while (estimated > effectiveLimit) {
            if (windowDetail > Math.min(1, windows.size())) {
                windowDetail = Math.min(1, windows.size());
            } else if (includeEvidence) {
                includeEvidence = false;
            } else if (includeEngagements) {
                includeEngagements = false;
            } else if (includeEnemyPositions) {
                includeEnemyPositions = false;
            } else if (includeDamageWindows) {
                includeDamageWindows = false;
            } else if (includePhases) {
                includePhases = false;
            } else if (includeWindowDetail) {
                includeWindowDetail = false;
            } else if (includeTop) {
                includeTop = false;
            } else {
                break;
            }
            truncated = true;
            content = assemble(baseContent, evidenceForPrompt, features, windows,
                    windowDetail, includeEvidence, includeEngagements,
                    includeEnemyPositions, enemyPositionsSection,
                    includeDamageWindows, damageWindowsSection,
                    includePhases, includeTop, includeWindowDetail, battle);
            estimated = estimate(estimator, TACTICAL_SYSTEM_PROMPT, content);
        }

        final String budgetSummary = String.format(
                "tokens=%d/%d windows=%d evidence=%s phases=%s truncated=%s",
                estimated, effectiveLimit, windowDetail, includeEvidence, includePhases,
                truncated);
        return new PreparedHarnessPrompt(
                TACTICAL_SYSTEM_PROMPT, content, estimated, truncated, budgetSummary);
    }

    private static String assemble(
            final String baseContent,
            final List<AiEvidence> evidenceForPrompt,
            final PlayerBattleFeatureSet features,
            final List<AiEvidence> windows,
            final int windowDetail,
            final boolean includeEvidence,
            final boolean includeEngagements,
            final boolean includeEnemyPositions,
            final String enemyPositionsSection,
            final boolean includeDamageWindows,
            final String damageWindowsSection,
            final boolean includePhases,
            final boolean includeTop,
            final boolean includeWindowDetail,
            final Battle battle
    ) {
        final StringBuilder sb = new StringBuilder(baseContent);
        if (includeTop && !windows.isEmpty()) {
            sb.append("\n\n======================== TOP PIVOTAL WINDOWS（注意力索引，详细证据见文末） ========================\n");
            final int count = Math.min(MAX_TOP_WINDOWS, windows.size());
            for (int i = 0; i < count; i++) {
                sb.append(i + 1).append(". ")
                        .append(PlayerAnalysisTerms.battleRange(windows.get(i).startSec(), windows.get(i).endSec()))
                        .append(" | ").append(windows.get(i).summary()).append('\n');
            }
        }
        if (includePhases && features != null && features.phases() != null && !features.phases().isEmpty()) {
            sb.append("\n======================== BATTLE PHASE SUMMARY（阶段时间线·双方存活人数） ========================\n");
            sb.append(BattlePhaseTimelineSection.PHASE_SEMANTICS_NOTE);
            if (battle != null) {
                sb.append("DEATH_SOURCE=").append(BattlePhaseSummary.deathSourceLabel(battle)).append('\n');
            }
            sb.append(BattlePhaseTimelineSection.renderPlayerRows(features.phases()));
        }
        if (includeEngagements && features != null
                && features.engagements() != null && !features.engagements().isEmpty()) {
            sb.append("\n======================== 对炮明细（ENGAGEMENTS·后端确定性） ========================\n");
            for (final EngagementSummary e : features.engagements()) {
                sb.append("- ").append(PlayerAnalysisTerms.battleRange(e.startTime(), e.endTime()))
                        .append(" 对方: ").append(opponentNames(e.enemyAccountIds(), battle))
                        .append(" | 你输出 ").append(e.damageDealt())
                        .append(" / 损失 ").append(e.damageReceived())
                        .append(" | 结果: ").append(PlayerAnalysisTerms.outcomeLabel(e.outcome()))
                        .append(" | 置信度: ").append(PlayerAnalysisTerms.confidenceLabel(e.confidence()))
                        .append('\n');
            }
        }
        if (includeEnemyPositions && !enemyPositionsSection.isEmpty()) {
            sb.append("\n\n").append(enemyPositionsSection);
        }
        if (includeDamageWindows && !damageWindowsSection.isEmpty()) {
            sb.append("\n\n").append(damageWindowsSection);
        }
        if (includeEvidence && !evidenceForPrompt.isEmpty()) {
            sb.append("\n======================== TACTICAL EVIDENCE（Backend 确定性证据） ========================\n");
            // 注意：raw momentumSeries（逐采样点的可观察 HP 差）观察集合可能不同，
            // 直接展示会把 observation membership change 伪装成 HP momentum。
            // 这里只输出 HpMomentumSkill.detect() 安全比较后生成的 HP_MOMENTUM AiEvidence。
            final String sections = TacticalEvidenceFormatter.renderEvidenceSections(evidenceForPrompt);
            if (!sections.isBlank()) {
                sb.append(sections);
            }
        }
        if (includeWindowDetail && !windows.isEmpty()) {
            sb.append("\n======================== CRITICAL DECISION WINDOWS（完整证据） ========================\n");
            final int count = Math.min(windowDetail, windows.size());
            for (int i = 0; i < count; i++) {
                sb.append("WINDOW #").append(i + 1).append(" ")
                        .append(TacticalEvidenceFormatter.renderWindow(windows.get(i), true));
            }
        }
        // TASK 必须是 user prompt 最后一个业务 section：证据之后再给最终推理指令
        sb.append("\n\n").append(taskSection());
        return sb.toString();
    }

    /** 关键窗口是否携带换血伤害数字（覆盖不全时防御性剔除，避免未来调用方传入未过滤结果）。 */
    private static boolean windowCarriesTradeDamage(final AiEvidence window) {
        final Map<String, Double> numbers = window.numbers();
        return numbers != null
                && (numbers.containsKey("recorderDamageDealt")
                        || numbers.containsKey("recorderDamageReceived"));
    }

    /** 对炮明细的对方玩家：优先昵称，缺失时回退 accountId。 */
    private static String opponentNames(final List<Long> accountIds, final Battle battle) {
        if (accountIds == null || accountIds.isEmpty()) {
            return "未知";
        }
        final List<String> names = new ArrayList<>();
        for (final Long id : accountIds) {
            String name = String.valueOf(id);
            if (battle != null && battle.players != null) {
                for (final PlayerResult p : battle.players) {
                    if (p != null && Long.valueOf(p.accountId).equals(id)
                            && p.nickname != null && !p.nickname.isBlank()) {
                        name = p.nickname;
                        break;
                    }
                }
            }
            names.add(PlayerResultFormat.quoteForPrompt(name));
        }
        return String.join("、", names);
    }

    private static String snapshot(
            final Battle battle,
            final ReplayReconstruction recon,
            final PlayerBattleFeatureSet features,
            final RecorderEntityMapping recorder) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("======================== BATTLE SNAPSHOT ========================\n");
        sb.append(PlayerReplayPromptBuilder.buildSummary(
                battle, recon,
                features != null && features.keyEvents() != null ? features.keyEvents() : List.of()));
        // 走位/区域时间线（RECORDER_REGION_TIMELINE + 压缩移动段）：fallback 有、Harness 之前缺失
        if (features != null) {
            PlayerReplayPromptBuilder.appendRecorderMovementEvidence(
                    sb, features.movements(), battle == null ? null : battle.mapName);
        }
        final String teamLabel = recorder != null && recorder.team() != null
                ? (recorder.team() == 1 ? "TEAM_A" : "TEAM_B") : "UNKNOWN";
        final String tank = recorder != null && recorder.tankId() != null
                ? ReplayDisplayNames.tankName(recorder.tankId(), "") : "未知";
        sb.append("\n录像者: ").append(teamLabel)
                .append(" 坦克: ").append(PromptDataQuoter.quote(tank, "未知坦克")).append('\n');
        return sb.toString();
    }

    private static String priorSection(final PreBattleStrategicPrior prior) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("======================== PRE-BATTLE STRATEGIC PRIOR（Call #1 赛前战略基线，未读取任何战斗结果） ========================\n");
        if (prior == null || !prior.hasContent()) {
            sb.append("（本次赛前战略基线不可用：Call #1 未产出有效结果）\n");
            return sb.toString();
        }
        appendTeamProfile(sb, "TEAM_A（队伍1）", prior.teamA());
        appendTeamProfile(sb, "TEAM_B（队伍2）", prior.teamB());
        if (!prior.keyMatchups().isEmpty()) {
            sb.append("\n关键对阵:\n");
            for (final PreBattleStrategicPrior.KeyMatchup m : prior.keyMatchups()) {
                sb.append("  - 区域 ").append(PromptDataQuoter.quote(m.area(), "未知"))
                        .append(" | 优势 ").append(PromptDataQuoter.quote(m.advantage(), "未知"))
                        .append(" | ").append(PromptDataQuoter.quote(m.reason(), "")).append('\n');
            }
        }
        if (!prior.strategicWinConditions().isEmpty()) {
            sb.append("\n战略胜机:\n");
            for (final PreBattleStrategicPrior.StrategicWinCondition w : prior.strategicWinConditions()) {
                sb.append("  - ").append(PromptDataQuoter.quote(w.team(), "未知"))
                        .append(": ").append(PromptDataQuoter.quote(w.condition(), "")).append('\n');
            }
        }
        if (!prior.hypotheses().isEmpty()) {
            sb.append("\n战略假设（Task 中需要逐条判定状态）:\n");
            for (final PreBattleStrategicPrior.StrategicHypothesis h : prior.hypotheses()) {
                sb.append("  [").append(hypothesisIdLabel(h.id())).append("] ")
                        .append(PromptDataQuoter.quote(h.claim(), ""))
                        .append("（理由: ").append(PromptDataQuoter.quote(h.reason(), "")).append("）\n");
            }
        }
        return sb.toString();
    }

    private static String hypothesisIdLabel(final String id) {
        if (id == null) {
            return "H?";
        }
        final String sanitized = id.replaceAll("[\\[\\]\\n\\r]", " ").trim();
        return sanitized.isBlank() ? "H?" : sanitized;
    }

    private static void appendTeamProfile(
            final StringBuilder sb,
            final String label,
            final PreBattleStrategicPrior.TeamProfile profile) {
        if (profile == null) {
            sb.append('\n').append(label).append(": （无数据）\n");
            return;
        }
        sb.append('\n').append(label).append(":\n");
        if (!profile.composition().isEmpty()) {
            sb.append("  阵容属性: ");
            final List<String> parts = new ArrayList<>();
            profile.composition().forEach((k, v) -> parts.add(k + "=" + v));
            sb.append(String.join(" ", parts)).append('\n');
        }
        if (!profile.strengths().isEmpty()) {
            sb.append("  优势: ").append(String.join("；", profile.strengths())).append('\n');
        }
        if (!profile.weaknesses().isEmpty()) {
            sb.append("  劣势: ").append(String.join("；", profile.weaknesses())).append('\n');
        }
        if (!profile.preferredPlans().isEmpty()) {
            sb.append("  首选方案: ").append(String.join("；", profile.preferredPlans())).append('\n');
        }
    }

    private static String taskSection() {
        return """
                ======================== TASK ========================
                对照赛前 Strategic Prior 和真实战斗执行情况进行复盘，重点分析 Critical Decision Windows。
                对每个关键窗口回答：
                1. 发生了什么？
                2. 为什么重要？
                3. 是否偏离赛前理论战略？
                4. 这种偏离是否合理？
                5. 录像者当时的选择是否合理？
                6. 更好的处理方式是什么？
                最后给出 3-5 条可执行训练建议。
                要求：
                - 先逐条输出 Hypothesis 状态（格式见规则），再写正文复盘；
                - 引用证据时必须带时间（X分XX秒）、区域编号或具体数值；
                - 无法从证据确定的内容明确写"无法从当前回放数据确定"；
                - 最终正文使用自然流畅的简体中文，禁止回写机器标签。""";
    }

    private static int estimate(
            final AiTokenEstimator estimator,
            final String systemPrompt,
            final String userContent) {
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent));
        return estimator.estimateMessagesTokens(messages);
    }
}
