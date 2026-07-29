package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.util.PromptDataQuoter;
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MultiTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.Vector3;

import com.wotb.web.replay.exception.AiPromptBudgetExceededException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.util.StringUtils;

/**
 * 将 Team Context 压缩为确定性、长度受限的 AI 输入。
 * 不接收或输出原始 ReplayEvent/逐帧位置流。
 *
 * 使用 AiTokenEstimator 进行 token 预算管理，不再使用固定字符限制或固定数量截断。
 */
final class TeamAiPromptBuilder {

    private TeamAiPromptBuilder() {
    }

    // ---- 向后兼容的重载（无 token 估算，适用于测试等） ----

    static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        return single(context, List.of(), null, Integer.MAX_VALUE);
    }

    static PromptInput single(final SingleTeamBattleAnalysisContext context, final List<String> extraLimitations) {
        return single(context, extraLimitations, null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    static PromptInput single(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations,
            final AiTokenEstimator estimator,
            final int maxInputTokens
    ) {
        final Set<String> limitations = collectLimitations(context, extraLimitations);

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

        // 构建所有 HPF（无固定截断）
        final BudgetWriter hpfTemp = new BudgetWriter();
        appendHighPriorityFacts(hpfTemp, context.features(), context.analysisUnitId());
        final String hpfBlock = hpfTemp.content();

        // 构建所有 optional details（无固定截断）
        final BudgetWriter optTemp = new BudgetWriter();
        appendOptionalDetails(optTemp, context.features(), context.analysisUnitId());
        final String optBlock = optTemp.content();

        // 如果 mandatory（header + HPF）超出 token 预算，直接抛出异常
        if (estimator != null) {
            final String mandatoryContent = headerBlock + hpfBlock;
            if (estimator.estimateTextTokens(mandatoryContent) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
        }

        // 写入所有内容
        final BudgetWriter writer = new BudgetWriter();
        writer.appendRequired(headerBlock);
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
        return multi(context, Map.of(), null, Integer.MAX_VALUE);
    }

    static PromptInput multi(final MultiTeamBattleAnalysisContext context,
                             final Map<String, List<String>> evidenceLimitations) {
        return multi(context, evidenceLimitations, null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    static PromptInput multi(final MultiTeamBattleAnalysisContext context,
                             final Map<String, List<String>> evidenceLimitations,
                             final AiTokenEstimator estimator,
                             final int maxInputTokens) {
        final List<TeamBattleAnalysisSummary> perspectives = context.perspectives();
        final Set<String> globalLimitations = new LinkedHashSet<>(context.limitations());

        // 构建 global header
        final StringBuilder globalHeader = new StringBuilder();
        globalHeader.append("=== MULTI_TEAM_CONTEXT ===\n");
        globalHeader.append("perspectiveCount=").append(context.perspectiveCount()).append("\n");
        globalHeader.append("uniqueBattleCount=").append(context.uniqueBattleCount()).append("\n");
        globalHeader.append("rosterConsistent=").append(context.rosterConsistent()).append("\n");
        if (!context.rosterConsistent()) {
            globalLimitations.add("ROSTER_CONSISTENCY_UNCONFIRMED");
        }
        final String globalHeaderStr = globalHeader.toString();

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
            perspectiveSections.add(buildPerspectiveSections(perspective, perUnitLimits, index));
        }

        // 3-4. 估算所有 mandatory/HPF 总 token 数，超限则抛异常
        if (estimator != null) {
            final StringBuilder mandatoryBuf = new StringBuilder();
            mandatoryBuf.append(globalHeaderStr);
            for (final PerspectivePromptSections section : perspectiveSections) {
                mandatoryBuf.append(section.mandatoryBlock());
                mandatoryBuf.append(section.highPriorityBlock());
            }
            if (estimator.estimateTextTokens(mandatoryBuf.toString()) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
        }

        // 5. 写入 mandatory 内容到最终 writer
        final BudgetWriter writer = new BudgetWriter();
        writer.appendRequired(globalHeaderStr);

        final Set<String> truncatedIds = new LinkedHashSet<>();
        for (final PerspectivePromptSections section : perspectiveSections) {
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
            final int index
    ) {
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
                mandatory.toString(),
                hpfContent,
                hpfTruncated,
                optContent,
                optTruncated,
                List.copyOf(perUnitLimits)
        );
    }

    // ---- 内容构建方法 ----

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
        for (int index = 0; index < members.size(); index++) {
            final TeamMemberFeatureSet member = members.get(index);
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    + " entityIds=" + member.entityIds()
                    + " mapping=" + member.mappingConfidence()
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
        for (int index = 0; index < members.size(); index++) {
            if (!members.get(index).movements().isEmpty()) {
                hasMovements = true;
                break;
            }
        }
        if (!hasMovements) return;
        writer.append("\n=== MEMBER_MOVEMENTS ===\n");
        for (int index = 0; index < members.size(); index++) {
            final TeamMemberFeatureSet member = members.get(index);
            if (member.movements().isEmpty()) continue;
            for (int movementIndex = 0; movementIndex < member.movements().size(); movementIndex++) {
                final MovementSegment movement = member.movements().get(movementIndex);
                final String startInfo = formatRawPosition(movement.rawStartPosition());
                final String endInfo = formatRawPosition(movement.rawEndPosition());
                writer.append("  movement[" + format(movement.startTime())
                        + "-" + format(movement.endTime()) + "]"
                        + " type=" + movement.type()
                        + " distance=" + format(movement.distance())
                        + " avgSpeed=" + format(movement.averageSpeed())
                        + " start=" + startInfo
                        + " end=" + endInfo
                        + " confidence=" + movement.confidence()
                        + "\n");
            }
        }
    }

    private static void appendFormation(
            final BudgetWriter writer,
            final List<TeamFormationPhase> phases
    ) {
        writer.append("\n=== FORMATION_PHASES ===\n");
        for (int index = 0; index < phases.size(); index++) {
            final TeamFormationPhase phase = phases.get(index);
            final String phasePosInfo = formatCanonicalPosition(phase.centroid());
            writer.append("formation[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " " + phasePosInfo
                    + " dispersion=" + format(phase.averageDispersion())
                    + " clusters=" + phase.clusterCount()
                    + " members=" + phase.observedMemberCount()
                    + " confidence=" + phase.confidence()
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
                        + " confidence=" + cluster.confidence()
                        + "\n");
            }
        }
    }

    private static void appendEngagements(
            final BudgetWriter writer,
            final List<TeamEngagementSummary> engagements
    ) {
        writer.append("\n=== TEAM_ENGAGEMENTS_OBSERVED_SUBSET ===\n");
        for (int index = 0; index < engagements.size(); index++) {
            final TeamEngagementSummary engagement = engagements.get(index);
            writer.append("engagement[" + format(engagement.startTime())
                    + "-" + format(engagement.endTime()) + "]"
                    + " allies=" + engagement.alliedAccountIds()
                    + " enemies=" + engagement.enemyAccountIds()
                    + " dealtSubset=" + engagement.damageDealt()
                    + " receivedSubset=" + engagement.damageReceived()
                    + " focusedTargets=" + engagement.focusedTargetAccountIds()
                    + " targetSwitches=" + engagement.targetSwitchCount()
                    + " outcome=" + engagement.outcome()
                    + " confidence=" + engagement.confidence()
                    + "\n");
        }
    }

    private static void appendKeyEvents(
            final BudgetWriter writer,
            final List<KeyBattleEvent> events
    ) {
        writer.append("\n=== KEY_EVENTS ===\n");
        for (int index = 0; index < events.size(); index++) {
            final KeyBattleEvent event = events.get(index);
            writer.append("event[" + format(event.clockSec()) + "]"
                    + " type=" + event.type()
                    + " evidence=" + quoteData(event.label())
                    + " source=" + event.source()
                    + " confidence=" + event.confidence()
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

    /** Delegates to shared {@link ReplayDisplayNames#mapName}. */
    private static String resolveMapName(final String mapCode) {
        return ReplayDisplayNames.mapName(mapCode);
    }

    /**
     * Resolve team result as three-state label (no raw winnerTeam).
     * Only accepts raw teams 1 or 2; anything else returns DRAW_OR_UNKNOWN.
     */
    private static String resolveTeamResult(final Integer winnerTeam, final int perspectiveTeam) {
        if (!PlayerSideResolver.isValidRawTeam(winnerTeam != null ? winnerTeam : 0)
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return "DRAW_OR_UNKNOWN";
        }
        if (winnerTeam.equals(perspectiveTeam)) return "TEAM_WIN";
        return "TEAM_LOSS";
    }

    /**
     * Append battle phases to the prompt.
     */
    private static void appendBattlePhases(
            final BudgetWriter writer,
            final List<BattlePhaseSummary> phases
    ) {
        writer.append("\n=== BATTLE_PHASES ===\n");
        for (int index = 0; index < phases.size(); index++) {
            final BattlePhaseSummary phase = phases.get(index);
            writer.append("phase[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " type=" + phase.type()
                    + " confidence=" + phase.confidence()
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

    /** Resolve dominant clan label for a perspective team's players only. */
    private static String resolvePerspectiveLabel(
            final List<PlayerResult> players, final int perspectiveTeam) {
        if (players == null) return "未知队伍";
        final List<PlayerResult> perspectivePlayers = players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "未知队伍";
        return TeamPerspectiveLabelResolver.resolve(perspectivePlayers);
    }

    /** Delegates to shared {@link ReplayDisplayNames#tankName}. */
    private static String resolveTankName(final long tankId, final String existingTankName) {
        return ReplayDisplayNames.tankName(tankId, existingTankName);
    }

    // ---- 记录类型 ----

    private record PerspectivePromptSections(
        String analysisUnitId,
        String mandatoryBlock,
        String highPriorityBlock,
        boolean hpfTruncated,
        String optionalBlock,
        boolean optionalTruncated,
        List<String> perUnitLimitations
    ) {}

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

        private int estimateTokens(final AiTokenEstimator estimator) {
            return estimator.estimateTextTokens(content.toString());
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
