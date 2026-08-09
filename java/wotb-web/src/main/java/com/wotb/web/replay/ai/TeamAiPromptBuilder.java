package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MultiTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.util.PromptDataQuoter;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 将 Team Context 压缩为确定性、长度受限的 AI 输入。
 * 不接收或输出原始 ReplayEvent/逐帧位置流。
 * <p>
 * 使用 AiTokenEstimator 进行 token 预算管理，不再使用固定字符限制或固定数量截断。
 */
final class TeamAiPromptBuilder {

    private TeamAiPromptBuilder() {
    }

    // ---- 向后兼容的重载（无 token 估算，适用于测试等） ----

    static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        return single(context, List.of(), null, null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    static PromptInput single(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations,
            final PreBattleStrategicPrior prior,
            final AiTokenEstimator estimator,
            final int maxInputTokens
    ) {
        final Set<String> limitations = collectLimitations(context, extraLimitations);

        // 先构建 HPF：对方阵容属权威结算且体量很小（≤7 行），与本队事实同为 mandatory，
        // 不能被 optional 预算裁掉。构建结果决定是否需要补 OPPOSING_LINEUP_UNAVAILABLE，
        // 因此必须在 header 写出 unitLimitations 之前完成。
        final BudgetWriter hpfTemp = new BudgetWriter();
        appendHighPriorityFacts(hpfTemp, context.features(), context.analysisUnitId());
        if (!appendOpposingTeam(hpfTemp, context.battle(), context.perspectiveTeam())) {
            // prompt 要求逐车分析对方；拿不到对方名册时必须显式告知，避免 AI 跳过或编造
            limitations.add("OPPOSING_LINEUP_UNAVAILABLE");
        }
        final String hpfBlock = hpfTemp.content();
        final String priorBlock = priorSection(
                prior, context.perspectiveTeam(),
                context.battle() != null
                        ? resolvePerspectiveLabel(context.battle().players, context.perspectiveTeam())
                        : "");

        // 构建 header
        final StringBuilder headerBuf = new StringBuilder();
        headerBuf.append("=== SINGLE_TEAM_CONTEXT ===\n");
        headerBuf.append("analysisUnitId=").append(quoteData(context.analysisUnitId())).append("\n");
        headerBuf.append("file=").append(quoteData(context.fileName())).append("\n");
        headerBuf.append("battleIdentity=").append(quoteData(context.battleId())).append("\n");
        headerBuf.append("category=").append(context.battleCategory()).append("\n");
        if (context.battle() != null) {
            final String teamLabel = resolvePerspectiveLabel(
                    context.battle().players, context.perspectiveTeam());
            headerBuf.append("teamLabel=").append(quoteData(teamLabel)).append("\n");
            headerBuf.append("map=").append(quoteData(resolveMapName(context.battle().mapName))).append("\n");
            headerBuf.append("durationSec=").append(formatNullable(context.battle().durationS)).append("\n");
            final String result = resolveTeamResult(
                    context.battle().winnerTeam, context.perspectiveTeam());
            headerBuf.append("result=").append(result).append("\n");
        }
        headerBuf.append("unitLimitations=").append(limitations).append("\n");
        final String headerBlock = headerBuf.toString();

        // 构建所有 optional details（无固定截断）
        final BudgetWriter optTemp = new BudgetWriter();
        appendOptionalDetails(optTemp, context.features(), context.analysisUnitId());
        final String optBlock = optTemp.content();

        // 如果 mandatory（header + HPF + prior）超出 token 预算，直接抛出异常
        if (estimator != null) {
            final String mandatoryContent = headerBlock + priorBlock + hpfBlock;
            if (estimator.estimateTextTokens(mandatoryContent) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
        }

        // 写入所有内容
        final BudgetWriter writer = new BudgetWriter();
        writer.appendRequired(headerBlock);
        writer.appendRequired(priorBlock);
        writer.appendRequiredBlock(hpfBlock);
        writer.append(optBlock);

        return writer.finish(estimator, maxInputTokens,
                Set.of(), Set.of(context.analysisUnitId()), Set.of(), Set.of(),
                Map.of(context.analysisUnitId(), List.copyOf(limitations)));
    }

    private static Set<String> collectLimitations(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations
    ) {
        final Set<String> limitations = new LinkedHashSet<>(context.limitations());
        if (context.features() != null) {
            limitations.addAll(context.features().limitations());
        }
        limitations.addAll(extraLimitations);
        return limitations;
    }

    // ---- 向后兼容的 multi 重载 ----

    static PromptInput multi(final MultiTeamBattleAnalysisContext context) {
        return multi(context, Map.of(), Map.of(), Map.of(), null, Integer.MAX_VALUE);
    }

    static PromptInput multi(final MultiTeamBattleAnalysisContext context,
                             final Map<String, List<String>> evidenceLimitations) {
        return multi(context, evidenceLimitations, Map.of(), Map.of(), null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    static PromptInput multi(final MultiTeamBattleAnalysisContext context,
                             final Map<String, List<String>> evidenceLimitations,
                             final Map<String, PreBattleStrategicPrior> priorsByUnitId,
                             final Map<String, Integer> perspectiveTeamByUnitId,
                             final AiTokenEstimator estimator,
                             final int maxInputTokens) {
        final List<TeamBattleAnalysisSummary> perspectives = context.perspectives();
        final Set<String> globalLimitations = new LinkedHashSet<>(context.limitations());

        // 构建 global header
        final String globalHeader = "=== MULTI_TEAM_CONTEXT ===\n" +
                "perspectiveCount=" + context.perspectiveCount() + "\n" +
                "uniqueBattleCount=" + context.uniqueBattleCount() + "\n" +
                "rosterConsistent=" + context.rosterConsistent() + "\n";
        if (!context.rosterConsistent()) {
            globalLimitations.add("ROSTER_CONSISTENCY_UNCONFIRMED");
        }

        // 2. 构建所有 perspective 的 mandatory/HPF 内容（临时写入器，不写入 finally）
        final List<PerspectivePromptSections> perspectiveSections = new ArrayList<>(perspectives.size());
        for (int index = 0; index < perspectives.size(); index++) {
            final TeamBattleAnalysisSummary perspective = perspectives.get(index);
            final Set<String> perUnitLimits = new LinkedHashSet<>();
            if (perspective.features() != null) {
                perUnitLimits.addAll(perspective.features().limitations());
            }
            final List<String> evLimits = evidenceLimitations.get(perspective.analysisUnitId());
            if (evLimits != null) {
                perUnitLimits.addAll(evLimits);
            }
            perspectiveSections.add(buildPerspectiveSections(
                    perspective,
                    perUnitLimits,
                    index,
                    priorsByUnitId.get(perspective.analysisUnitId()),
                    perspectiveTeamByUnitId.getOrDefault(perspective.analysisUnitId(), 1)));
        }

        // 3-4. 估算所有 mandatory/HPF 总 token 数，超限则抛异常
        if (estimator != null) {
            final StringBuilder mandatoryBuf = new StringBuilder();
            mandatoryBuf.append(globalHeader);
            for (final PerspectivePromptSections section : perspectiveSections) {
                mandatoryBuf.append(section.priorBlock());
                mandatoryBuf.append(section.mandatoryBlock());
                mandatoryBuf.append(section.highPriorityBlock());
            }
            if (estimator.estimateTextTokens(mandatoryBuf.toString()) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
        }

        // 5. 写入 mandatory 内容到最终 writer
        final BudgetWriter writer = new BudgetWriter();
        writer.appendRequired(globalHeader);

        final Set<String> truncatedIds = new LinkedHashSet<>();
        for (final PerspectivePromptSections section : perspectiveSections) {
            writer.appendRequired(section.priorBlock());
            writer.appendRequired(section.mandatoryBlock());
            writer.appendRequiredBlock(section.highPriorityBlock());
            if (section.hpfTruncated()) {
                truncatedIds.add(section.analysisUnitId());
                writer.markTruncated();
            }
        }

        // 6-8. 按 perspective 逐个写入 optional block，检查预算
        for (final PerspectivePromptSections section : perspectiveSections) {
            final String optBlock = section.optionalBlock();
            if (!StringUtils.hasText(optBlock)) {
                continue;
            }
            // 检查下一个 block 是否会导致超限
            if (estimator != null) {
                final String projectedContent = writer.content() + optBlock;
                if (estimator.estimateTextTokens(projectedContent) > maxInputTokens) {
                    truncatedIds.add(section.analysisUnitId());
                    writer.markTruncated();
                    continue;
                }
            }
            writer.append(optBlock);
            if (section.optionalTruncated()) {
                truncatedIds.add(section.analysisUnitId());
                writer.markTruncated();
            }
        }

        final Set<String> includedIds = new LinkedHashSet<>();
        final Map<String, List<String>> perUnitLimMap = new LinkedHashMap<>();
        for (int i = 0; i < perspectives.size(); i++) {
            final String id = perspectives.get(i).analysisUnitId();
            includedIds.add(id);
            perUnitLimMap.put(id, perspectiveSections.get(i).perUnitLimitations());
        }

        // 9. 最终重新估算并保证低于 budget
        return writer.finish(estimator, maxInputTokens,
                globalLimitations, includedIds, Set.of(), truncatedIds, perUnitLimMap);
    }

    // ---- 用于 multi 的辅助方法 ----

    private static PerspectivePromptSections buildPerspectiveSections(
            final TeamBattleAnalysisSummary perspective,
            final Set<String> perUnitLimits,
            final int index,
            final PreBattleStrategicPrior prior,
            final int perspectiveTeam
    ) {
        final String priorBlock = priorSection(prior, perspectiveTeam, perspective.teamLabel());
        final StringBuilder mandatory = new StringBuilder(512);
        mandatory.append("\n=== PERSPECTIVE ").append(index + 1).append(" ===\n");
        mandatory.append("analysisUnitId=").append(quoteData(perspective.analysisUnitId())).append("\n");
        mandatory.append("file=").append(quoteData(perspective.fileName())).append("\n");
        mandatory.append("battleIdentity=").append(quoteData(perspective.battleIdentity())).append("\n");
        mandatory.append("map=").append(quoteData(resolveMapName(perspective.mapName()))).append("\n");
        mandatory.append("category=").append(perspective.battleCategory()).append("\n");
        mandatory.append("durationSec=").append(formatNullable(perspective.durationSec())).append("\n");
        mandatory.append("teamLabel=").append(quoteData(perspective.teamLabel())).append("\n");
        mandatory.append("rosterAccountIds=").append(perspective.rosterAccountIds()).append("\n");
        if (!perUnitLimits.isEmpty()) {
            mandatory.append("unitLimitations=").append(perUnitLimits).append("\n");
        }
        final BudgetWriter hpfTemp = new BudgetWriter();
        appendHighPriorityFacts(hpfTemp, perspective.features(), perspective.analysisUnitId());
        final String hpfContent = hpfTemp.content();
        final boolean hpfTruncated = hpfTemp.isTruncated();
        final BudgetWriter optTemp = new BudgetWriter();
        appendOptionalDetails(optTemp, perspective.features(), perspective.analysisUnitId());
        final String optContent = optTemp.content();
        final boolean optTruncated = optTemp.isTruncated();
        return new PerspectivePromptSections(
                perspective.analysisUnitId(),
                priorBlock,
                mandatory.toString(),
                hpfContent,
                hpfTruncated,
                optContent,
                optTruncated,
                List.copyOf(perUnitLimits)
        );
    }

    // ---- 内容构建方法 ----

    /**
     * 渲染 Call #1 赛前战略基线（视角相对标签）：
     * TEAM_A=你的队伍（teamLabel）、TEAM_B=对方队伍；视角队伍为 2 时交换 Call #1 的 TEAM_A/TEAM_B。
     */
    private static String priorSection(final PreBattleStrategicPrior prior,
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
            sb.append("\n战略假设（复盘需逐条判定状态）:\n");
            for (final PreBattleStrategicPrior.StrategicHypothesis h : prior.hypotheses()) {
                sb.append("  [").append(hypothesisIdLabel(h.id())).append("] ")
                        .append(quoteData(swapped ? swapTeamToken(h.claim()) : h.claim()))
                        .append("（理由: ").append(quoteData(swapped ? swapTeamToken(h.reason()) : h.reason()))
                        .append("）\n");
            }
        }
        return sb.toString();
    }

    private static void appendTeamProfile(final StringBuilder sb,
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
            sb.append("  首选方案: ").append(String.join("；", profile.preferredPlans())).append('\n');
        }
    }

    private static String hypothesisIdLabel(final String id) {
        if (id == null) {
            return "H?";
        }
        final String sanitized = id.replaceAll("[\\[\\]\\n\\r]", " ").trim();
        return sanitized.isBlank() ? "H?" : sanitized;
    }

    /** 视角队伍为 2 时，把 Call #1 输出中的 TEAM_A/TEAM_B 对调（单遍替换）。 */
    private static String swapTeamToken(final String text) {
        if (text == null || text.isBlank()) {
            return text == null ? "" : text;
        }
        return text.replace("TEAM_A", "\u0000A")
                .replace("TEAM_B", "TEAM_A")
                .replace("\u0000A", "TEAM_B");
    }

    private static void appendHighPriorityFacts(
            final BudgetWriter writer,
            final TeamBattleFeatureSet features,
            final String analysisUnitId
    ) {
        writer.append("\n=== PERSPECTIVE_FACTS ===\n");
        writer.append("analysisUnitId=" + quoteData(analysisUnitId) + "\n");
        if (features == null) {
            writer.append("features=UNAVAILABLE\n");
            return;
        }
        appendAuthoritative(writer, features.authoritativeAggregate());
        appendObserved(writer, features.observedAggregate());
        appendMemberFacts(writer, features.members());
        writer.append("coverage=" + features.coverage() + "\n");
    }

    /**
     * 对方阵容（权威结算）。团队证据此前只描述录像者所在队伍，
     * 对手完全缺失，AI 无从做威胁分析。名册来自权威结算 {@code battle.players}，
     * 坦克名称与车种/等级/国家只由 tankId 查表得到，不解析名称文本。
     *
     * @return 是否输出了内容
     */
    private static boolean appendOpposingTeam(
            final BudgetWriter writer,
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
                    + structuredTankFacts(p.tankId)
                    + " finalDamage=" + p.damageDealt
                    + " damageReceived=" + p.damageReceived
                    + " assisted=" + p.damageAssisted
                    + " blocked=" + p.damageBlocked
                    + " kills=" + p.kills
                    + " hits=" + p.nHitsDealt
                    + " penetrations=" + p.nPenetrationsDealt
                    + " enemiesDamaged=" + p.nEnemiesDamaged
                    + " survived=" + p.survived
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

    /**
     * tankopedia 的结构化车辆事实（tier / nation / alphaDamage / hp / extraInfo）。
     * 只在 Tankopedia 确实提供字段时输出；10 级多炮车没有 vehicle 级 alphaDamage 时
     * 自动省略，绝不猜测；extraInfo 是手工维护的不可信数据，必须 JSON 引用/转义。
     */
    static String structuredTankFacts(final long tankId) {
        final StringBuilder sb = new StringBuilder(80);
        appendFact(sb, "tier", ReplayDisplayNames.tankTier(tankId));
        appendFact(sb, "nation", ReplayDisplayNames.tankNation(tankId));
        appendFact(sb, "alphaDamage", ReplayDisplayNames.tankAlphaDamage(tankId));
        appendFact(sb, "hp", ReplayDisplayNames.tankMaxHp(tankId));
        sb.append(extraInfoFact(ReplayDisplayNames.tankExtraInfo(tankId)));
        return sb.toString();
    }

    private static void appendFact(final StringBuilder sb, final String key, final String value) {
        if (!value.isEmpty()) {
            sb.append(' ').append(key).append('=').append(value);
        }
    }

    /** extraInfo 事实片段；空串返回空串，非空必须 JSON 引用/转义（不可信数据）。 */
    static String extraInfoFact(final String extraInfo) {
        return extraInfo.isEmpty() ? "" : " extraInfo=" + quoteData(extraInfo);
    }

    private static void appendOptionalDetails(
            final BudgetWriter writer,
            final TeamBattleFeatureSet features,
            final String analysisUnitId
    ) {
        writer.append("\n=== PERSPECTIVE_OPTIONAL ===\n");
        writer.append("analysisUnitId=" + quoteData(analysisUnitId) + "\n");
        if (features == null) {
            return;
        }
        appendMemberMovements(writer, features.members());
        appendFormation(writer, features.formationPhases());
        appendBattlePhases(writer, features.battlePhases());
        appendEngagements(writer, features.engagements());
        appendKeyEvents(writer, features.keyEvents());
    }

    private static void appendAuthoritative(
            final BudgetWriter writer,
            final TeamAggregateResult aggregate
    ) {
        writer.append("\n=== AUTHORITATIVE_TEAM_RESULT ===\n");
        if (aggregate == null) {
            writer.append("UNAVAILABLE\n");
            return;
        }
        writer.append("memberCount=" + aggregate.memberCount() + "\n");
        writer.append("damageDealt=" + aggregate.totalDamageDealt() + "\n");
        writer.append("damageReceived=" + aggregate.totalDamageReceived() + "\n");
        writer.append("assistedDamage=" + aggregate.totalAssistedDamage() + "\n");
        writer.append("blockedDamage=" + aggregate.totalBlockedDamage() + "\n");
        writer.append("kills=" + aggregate.totalKills() + "\n");
        writer.append("survivors=" + aggregate.survivorCount() + "\n");
        writer.append("deaths=" + aggregate.deathCount() + "\n");
        writer.append("averageDeathTimeSec=" + formatScalar(
                aggregate.averageDeathTimeSec()) + "\n");
        writer.append("firstDeathTimeSec=" + formatScalar(
                aggregate.firstDeathTimeSec()) + "\n");
        writer.append("lastDeathTimeSec=" + formatScalar(
                aggregate.lastDeathTimeSec()) + "\n");
        writer.append("win=" + formatScalar(aggregate.win()) + "\n");
    }

    private static void appendObserved(
            final BudgetWriter writer,
            final TeamObservedAggregate aggregate
    ) {
        writer.append("\n=== OBSERVED_EVENT_SUBSET_NOT_AUTHORITATIVE ===\n");
        if (aggregate == null) {
            writer.append("UNAVAILABLE\n");
            return;
        }
        writer.append("damageDealtSubset=" + aggregate.damageDealt() + "\n");
        writer.append("damageReceivedSubset=" + aggregate.damageReceived() + "\n");
        writer.append("attributedDamageEvents=" + aggregate.attributedDamageEventCount() + "\n");
        writer.append("unattributedDamageEvents="
                + aggregate.unattributedDamageEventCount() + "\n");
    }

    private static void appendMemberFacts(
            final BudgetWriter writer,
            final List<TeamMemberFeatureSet> members
    ) {
        writer.append("\n=== TEAM_MEMBERS ===\n");
        for (final TeamMemberFeatureSet member : members) {
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    // vehicleClass / tier / nation 只来自 tankopedia 的结构化字段，不得由 tank 名称推断
                    + " vehicleClass=" + resolveTankClass(member.tankId())
                    + structuredTankFacts(member.tankId())
                    + " entityIds=" + member.entityIds()
                    + " mapping=" + PlayerAnalysisTerms.confidenceLabel(member.mappingConfidence())
                    + " finalDamage=" + member.finalDamage()
                    + " damageReceived=" + member.damageReceived()
                    + " assisted=" + member.assistedDamage()
                    + " blocked=" + member.blockedDamage()
                    + " kills=" + member.kills()
                    + " survived=" + member.survived()
                    + " deathTimeSec=" + formatScalar(member.deathTimeSec())
                    + "\n");
            if (!member.limitations().isEmpty()) {
                writer.append("  memberLimitations=" + member.limitations() + "\n");
            }
        }
    }

    private static void appendMemberMovements(
            final BudgetWriter writer,
            final List<TeamMemberFeatureSet> members
    ) {
        boolean hasMovements = false;
        for (final TeamMemberFeatureSet teamMemberFeatureSet : members) {
            if (!teamMemberFeatureSet.movements().isEmpty()) {
                hasMovements = true;
                break;
            }
        }
        if (!hasMovements) return;
        writer.append("\n=== MEMBER_MOVEMENTS ===\n");
        for (final TeamMemberFeatureSet member : members) {
            if (member.movements().isEmpty()) continue;
            // 必须标出归属成员：否则所有成员的移动段被打成一个匿名平铺列表，AI 无法归属
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    + " vehicleClass=" + resolveTankClass(member.tankId())
                    + "\n");
            // 压缩区域序列（1-9 区，与回放九宫格一致）：让 AI 一眼看到该成员的整场路线
            final List<String> regionSequence = new ArrayList<>();
            String lastRegion = null;
            for (final MovementSegment movement : member.movements()) {
                final String startRegion = regionOf(movement.rawStartPosition());
                if (startRegion != null && !startRegion.equals(lastRegion)) {
                    regionSequence.add(startRegion);
                    lastRegion = startRegion;
                }
                final String endRegion = regionOf(movement.rawEndPosition());
                if (endRegion != null && !endRegion.equals(lastRegion)) {
                    regionSequence.add(endRegion);
                    lastRegion = endRegion;
                }
            }
            if (!regionSequence.isEmpty()) {
                writer.append("  regionSequence=" + String.join("→", regionSequence) + "\n");
            }
            for (final MovementSegment movement : member.movements()) {
                final String startInfo = formatRawPosition(movement.rawStartPosition());
                final String endInfo = formatRawPosition(movement.rawEndPosition());
                writer.append("  movement[" + format(movement.startTime())
                        + "-" + format(movement.endTime()) + "]"
                        + " type=" + PlayerAnalysisTerms.movementLabel(movement.type())
                        + " distance=" + format(movement.distance())
                        + " avgSpeed=" + format(movement.averageSpeed())
                        + " start=" + startInfo
                        + " end=" + endInfo
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(movement.confidence())
                        + "\n");
            }
        }
    }

    private static void appendFormation(
            final BudgetWriter writer,
            final List<TeamFormationPhase> phases
    ) {
        writer.append("\n=== FORMATION_PHASES ===\n");
        for (final TeamFormationPhase phase : phases) {
            final String phasePosInfo = formatCanonicalPosition(phase.centroid());
            writer.append("formation[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " " + phasePosInfo
                    + " dispersion=" + format(phase.averageDispersion())
                    + " clusters=" + phase.clusterCount()
                    + " members=" + phase.observedMemberCount()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(phase.confidence())
                    + "\n");
            // Structured cluster output
            for (final TeamFormationCluster cluster : phase.clusters()) {
                writer.append("  cluster[" + format(cluster.startTime())
                        + "-" + format(cluster.endTime()) + "]"
                        + " region=" + cluster.region()
                        + " centroidXZ=(" + format(cluster.centroidX())
                        + "," + format(cluster.centroidZ()) + ")"
                        + " centroidStatus=" + cluster.centroidStatus()
                        + " clampedMemberPositions=" + cluster.clampedMemberPositionCount()
                        + " members=" + cluster.memberIdentities().stream()
                        .map(id -> PromptDataQuoter.quote(id, "?"))
                        .collect(Collectors.joining(",", "[", "]"))
                        + " memberCount=" + cluster.memberCount()
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(cluster.confidence())
                        + "\n");
            }
        }
    }

    private static void appendEngagements(
            final BudgetWriter writer,
            final List<TeamEngagementSummary> engagements
    ) {
        writer.append("\n=== TEAM_ENGAGEMENTS_OBSERVED_SUBSET ===\n");
        for (final TeamEngagementSummary engagement : engagements) {
            writer.append("engagement[" + format(engagement.startTime())
                    + "-" + format(engagement.endTime()) + "]"
                    + " allies=" + engagement.alliedAccountIds()
                    + " enemies=" + engagement.enemyAccountIds()
                    + " dealtSubset=" + engagement.damageDealt()
                    + " receivedSubset=" + engagement.damageReceived()
                    + " focusedTargets=" + engagement.focusedTargetAccountIds()
                    + " targetSwitches=" + engagement.targetSwitchCount()
                    + " outcome=" + PlayerAnalysisTerms.outcomeLabel(engagement.outcome())
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(engagement.confidence())
                    + "\n");
        }
    }

    private static void appendKeyEvents(
            final BudgetWriter writer,
            final List<KeyBattleEvent> events
    ) {
        writer.append("\n=== KEY_EVENTS ===\n");
        for (final KeyBattleEvent event : events) {
            writer.append("event[" + format(event.clockSec()) + "]"
                    + " type=" + PlayerAnalysisTerms.keyEventLabel(event.type())
                    + " evidence=" + quoteData(event.label())
                    + " source=" + event.source()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(event.confidence())
                    + " entities=" + event.relatedEntityIds()
                    + "\n");
        }
    }

    // ---- 格式化和解析辅助方法 ----

    private static String formatScalar(final Object value) {
        if (value == null) {
            return "UNKNOWN";
        }
        if (value instanceof Number number
                && !Double.isFinite(number.doubleValue())) {
            return "UNKNOWN";
        }
        return String.valueOf(value);
    }

    private static String quoteData(final Object value) {
        return PromptDataQuoter.quote(value, "UNKNOWN");
    }

    /**
     * Delegates to shared {@link ReplayDisplayNames#mapName}.
     */
    private static String resolveMapName(final String mapCode) {
        return ReplayDisplayNames.mapName(mapCode);
    }

    /**
     * Resolve team result as three-state label (no raw winnerTeam).
     * Only accepts raw teams 1 or 2; anything else returns DRAW_OR_UNKNOWN.
     */
    private static String resolveTeamResult(final Integer winnerTeam, final int perspectiveTeam) {
        // winnerTeam 合法可为 null（胜负未知/平局），不能标 @Nonnull，也不能直接拆箱
        if (winnerTeam == null
                || !PlayerSideResolver.isValidRawTeam(winnerTeam)
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return "平局或未知";
        }
        if (winnerTeam.equals(perspectiveTeam)) return "本队获胜";
        return "本队失利";
    }

    /**
     * Append battle phases to the prompt.
     */
    private static void appendBattlePhases(
            final BudgetWriter writer,
            final List<BattlePhaseSummary> phases
    ) {
        writer.append("\n=== BATTLE_PHASES ===\n");
        for (final BattlePhaseSummary phase : phases) {
            writer.append("phase[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " type=" + PlayerAnalysisTerms.phaseLabel(phase.type())
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(phase.confidence())
                    + "\n");
        }
    }

    private static String format(final double value) {
        return String.format(Locale.ROOT, "%.1f", value);
    }

    private static String formatNullable(final Double value) {
        return value == null || !Double.isFinite(value)
                ? "UNKNOWN" : format(value);
    }

    /**
     * Format an already-canonical position: validate range (enforced by CanonicalMapPosition),
     * derive region from canonical X/Z, and format. Performs NO raw→canonical mapping — the
     * input has already been resolved exactly once upstream.
     */
    private static String formatCanonicalPosition(final CanonicalMapPosition pos) {
        if (pos == null) return "UNKNOWN";
        return "(" + format(pos.x()) + "," + format(pos.z()) + ")";
    }

    /**
     * Format a RAW replay position: resolve raw replay coordinates through the single
     * coordinate resolver into canonical XZ, region, and clamp status.
     */
    private static String formatRawPosition(final Vector3 position) {
        if (position == null) return "UNKNOWN";
        final MapCoordinateResolution res = MapRegionResolver.resolve(position.x(), position.z());
        if (!res.usable()) return "UNKNOWN";
        return "(" + format(res.position().x()) + "," + format(res.position().z())
                + ") r=" + res.region() + " s=" + res.status().name();
    }

    /** raw 坐标 → 九宫格区域（1-9）；不可用返回 null。 */
    private static String regionOf(final Vector3 position) {
        if (position == null) return null;
        final int region = MapRegionResolver.resolveRegionFromRaw(position.x(), position.z());
        return region > 0 ? String.valueOf(region) : null;
    }

    /**
     * Resolve dominant clan label for a perspective team's players only.
     */
    private static String resolvePerspectiveLabel(
            final List<PlayerResult> players, final int perspectiveTeam) {
        if (players == null) return "未知队伍";
        final List<PlayerResult> perspectivePlayers = players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "未知队伍";
        return TeamPerspectiveLabelResolver.resolve(perspectivePlayers);
    }

    /**
     * Delegates to shared {@link ReplayDisplayNames#tankName}.
     */
    private static String resolveTankName(final long tankId, final String existingTankName) {
        return ReplayDisplayNames.tankName(tankId, existingTankName);
    }

    /**
     * Delegates to shared {@link ReplayDisplayNames#tankClass}.
     * 结构化车辆类型只由 tankId 查表得到，绝不解析 tank 名称文本。
     */
    private static String resolveTankClass(final long tankId) {
        return ReplayDisplayNames.tankClass(tankId);
    }

    // ---- 记录类型 ----

    private record PerspectivePromptSections(
            String analysisUnitId,
            String priorBlock,
            String mandatoryBlock,
            String highPriorityBlock,
            boolean hpfTruncated,
            String optionalBlock,
            boolean optionalTruncated,
            List<String> perUnitLimitations
    ) {
    }

    record PromptInput(
            String content,
            Set<String> includedUnitIds,
            Set<String> omittedUnitIds,
            Set<String> truncatedUnitIds,
            Map<String, List<String>> perUnitLimitations,
            List<String> globalLimitations
    ) {

        PromptInput {
            includedUnitIds = includedUnitIds == null ? Set.of() : Set.copyOf(includedUnitIds);
            omittedUnitIds = omittedUnitIds == null ? Set.of() : Set.copyOf(omittedUnitIds);
            truncatedUnitIds = truncatedUnitIds == null ? Set.of() : Set.copyOf(truncatedUnitIds);
            perUnitLimitations = perUnitLimitations == null ? Map.of() : Map.copyOf(perUnitLimitations);
            globalLimitations = globalLimitations == null ? List.of() : List.copyOf(globalLimitations);
        }
    }

    /**
     * 基于 token 预算的写入器。
     * 内部不作字符级别截断 — 所有 append 始终成功。
     * finish() 时使用 estimator 估算总 token 数，超限则标记 truncated。
     */
    private static final class BudgetWriter {

        private static final String TRUNCATION_LINE = "\nLIMITATION: AI_INPUT_TRUNCATED\n";

        private final StringBuilder content = new StringBuilder(4096);
        private boolean truncated;

        private BudgetWriter() {
        }

        private void append(final String value) {
            if (StringUtils.hasText(value)) {
                content.append(value);
            }
        }

        private void appendRequired(final String value) {
            if (StringUtils.hasText(value)) {
                content.append(value);
            }
        }

        private void appendRequiredBlock(final String block) {
            if (StringUtils.hasText(block)) {
                content.append(block);
            }
        }

        private String content() {
            return content.toString();
        }

        private boolean isTruncated() {
            return truncated;
        }

        private void markTruncated() {
            truncated = true;
        }

        private PromptInput finish(
                final AiTokenEstimator estimator,
                final int maxInputTokens,
                final Set<String> suppliedGlobalLimitations,
                final Set<String> includedIds,
                final Set<String> omittedIds,
                final Set<String> truncatedIds,
                final Map<String, List<String>> perUnitLimitations
        ) {
            final Set<String> globalLimitations = new LinkedHashSet<>(suppliedGlobalLimitations);
            // 在 finish 时估算 token 数，如果超限则标记 truncated
            if (estimator != null) {
                final String currentContent = content.toString();
                if (estimator.estimateTextTokens(currentContent) > maxInputTokens) {
                    truncated = true;
                }
            }
            if (truncated) {
                globalLimitations.add("AI_INPUT_TRUNCATED");
                content.append(TRUNCATION_LINE);
            }
            return new PromptInput(
                    content.toString(),
                    includedIds,
                    omittedIds,
                    truncatedIds,
                    perUnitLimitations,
                    new ArrayList<>(globalLimitations));
        }
    }
}
