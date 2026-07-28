package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.util.PromptDataQuoter;
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.Tankopedia;
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
 */
final class TeamAiPromptBuilder {

    static final int MAX_MEMBERS = 15;
    static final int MAX_MOVEMENTS_PER_MEMBER = 6;
    static final int MAX_FORMATION_PHASES = 20;
    static final int MAX_BATTLE_PHASES = 20;
    static final int MAX_ENGAGEMENTS = 20;
    static final int MAX_KEY_EVENTS = 30;
    static final int MAX_PERSPECTIVES = 10;
    static final int MAX_INPUT_CHARS = 30_000;
    static final String TRUNCATION_LINE = "\nLIMITATION: AI_INPUT_TRUNCATED\n";

    private TeamAiPromptBuilder() {
    }

    static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        return single(context, List.of());
    }

    static PromptInput single(final SingleTeamBattleAnalysisContext context, final List<String> extraLimitations) {
        final BudgetWriter writer = new BudgetWriter(MAX_INPUT_CHARS);
        final Set<String> limitations = collectLimitations(context, extraLimitations);

        // Pre-build header in a temp buffer to measure its size
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

        final BudgetWriter hpfTemp = new BudgetWriter(Integer.MAX_VALUE);
        appendHighPriorityFacts(hpfTemp, context.features(), context.analysisUnitId());
        final String hpfBlock = hpfTemp.content();
        final boolean hpfTruncated = hpfTemp.isTruncated();

        final BudgetWriter optTemp = new BudgetWriter(Integer.MAX_VALUE);
        appendOptionalDetails(optTemp, context.features(), context.analysisUnitId());
        final String optBlock = optTemp.content();
        final boolean optTruncated = optTemp.isTruncated();

        final int requiredSize = headerBlock.length() + hpfBlock.length() + TRUNCATION_LINE.length();
        if (requiredSize > MAX_INPUT_CHARS) {
            throw new AiPromptBudgetExceededException();
        }
        writer.appendRequired(headerBlock);
        writer.appendRequiredBlock(hpfBlock);
        if (hpfTruncated) {
            writer.markTruncated();
        }
        writer.append(optBlock);
        if (optTruncated) {
            writer.markTruncated();
        }
        final Set<String> truncatedIds = new LinkedHashSet<>();
        if (writer.isTruncated()) truncatedIds.add(context.analysisUnitId());
        return writer.finish(Set.of(), Set.of(context.analysisUnitId()), Set.of(), truncatedIds,
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

    static PromptInput multi(final MultiTeamBattleAnalysisContext context) {
        return multi(context, Map.of());
    }

    static PromptInput multi(final MultiTeamBattleAnalysisContext context, final Map<String, List<String>> evidenceLimitations) {
        final Set<String> globalLimitations = new LinkedHashSet<>(context.limitations());
        final List<TeamBattleAnalysisSummary> perspectives = context.perspectives();
        // Build global header
        final StringBuilder globalHeader = new StringBuilder();
        globalHeader.append("=== MULTI_TEAM_CONTEXT ===\n");
        globalHeader.append("perspectiveCount=").append(context.perspectiveCount()).append("\n");
        globalHeader.append("uniqueBattleCount=").append(context.uniqueBattleCount()).append("\n");
        globalHeader.append("rosterConsistent=").append(context.rosterConsistent()).append("\n");
        if (!context.rosterConsistent()) {
            globalLimitations.add("ROSTER_CONSISTENCY_UNCONFIRMED");
        }
        final int perspectiveLimit = Math.min(perspectives.size(), MAX_PERSPECTIVES);
        // Phase 1: build required sections for budget planning
        final List<PerspectivePromptSections> perspectiveSections = new ArrayList<>();
        for (int index = 0; index < perspectiveLimit; index++) {
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
        // Phase 1: budget planning
        final int reserve = TRUNCATION_LINE.length();
        final int maxOmittedFromCap = perspectives.size() - perspectiveLimit;
        int includedCount = perspectiveLimit;
        while (includedCount > 0) {
            final int budgetOmitted = perspectiveLimit - includedCount;
            final int totalOmitted = budgetOmitted + maxOmittedFromCap;
            final Set<String> budgetLim = new LinkedHashSet<>(globalLimitations);
            if (totalOmitted > 0) {
                budgetLim.add("PERSPECTIVES_OMITTED_COUNT_" + totalOmitted);
            }
            final String budgetLimLine = budgetLim.isEmpty() ? "" : "DATA_LIMITATIONS=" + budgetLim + "\n";
            int totalRequired = globalHeader.length() + budgetLimLine.length() + reserve;
            for (int i = 0; i < includedCount; i++) {
                totalRequired += perspectiveSections.get(i).mandatoryBlock().length();
                totalRequired += perspectiveSections.get(i).highPriorityBlock().length();
            }
            if (totalRequired <= MAX_INPUT_CHARS) {
                break;
            }
            includedCount--;
        }
        if (includedCount == 0 && perspectiveLimit > 0) {
            throw new AiPromptBudgetExceededException();
        }
        // Phase 2: write with budget reservation for future required blocks
        final BudgetWriter writer = new BudgetWriter(MAX_INPUT_CHARS);
        final int totalOmitted = (perspectiveLimit - includedCount) + maxOmittedFromCap;
        if (totalOmitted > 0) {
            globalLimitations.add("PERSPECTIVES_OMITTED_COUNT_" + totalOmitted);
        }
        final String finalLimLine = globalLimitations.isEmpty() ? "" : "DATA_LIMITATIONS=" + globalLimitations + "\n";
        // Reserve budget for all perspective required blocks
        for (int i = 0; i < includedCount; i++) {
            writer.reserve(perspectiveSections.get(i).mandatoryBlock().length());
        }
        writer.append(globalHeader.toString());
        writer.append(finalLimLine);
        // Phase 2: Write all mandatory perspective headers + unitLimitations
        for (int index = 0; index < includedCount; index++) {
            writer.release(perspectiveSections.get(index).mandatoryBlock().length());
            writer.append(perspectiveSections.get(index).mandatoryBlock());
        }
        // Phase 3: Write all high-priority facts (P2) for all included perspectives
        final Set<String> truncatedIds = new LinkedHashSet<>();
        for (int index = 0; index < includedCount; index++) {
            final PerspectivePromptSections section = perspectiveSections.get(index);
            writer.appendRequiredBlock(section.highPriorityBlock());
            final boolean optionalWritten = writer.append(section.optionalBlock());
            final boolean unitTruncated = section.hpfTruncated()
                    || section.optionalTruncated()
                    || !optionalWritten;
            if (unitTruncated) {
                truncatedIds.add(section.analysisUnitId());
                writer.markTruncated();
            }
        }
        final Set<String> includedIds = new LinkedHashSet<>();
        final Set<String> omittedIds = new LinkedHashSet<>();
        final Map<String, List<String>> perUnitLimMap = new LinkedHashMap<>();
        for (int i = 0; i < includedCount; i++) {
            final String id = perspectives.get(i).analysisUnitId();
            includedIds.add(id);
            perUnitLimMap.put(id, perspectiveSections.get(i).perUnitLimitations());
        }
        for (int i = includedCount; i < perspectives.size(); i++) {
            omittedIds.add(perspectives.get(i).analysisUnitId());
        }
        return writer.finish(globalLimitations, includedIds, omittedIds, truncatedIds, perUnitLimMap);
    }

    private static void appendContextHeader(
            final BudgetWriter writer,
            final SingleTeamBattleAnalysisContext context
    ) {
        writer.appendRequired("=== SINGLE_TEAM_CONTEXT ===\n");
        writer.appendRequired("analysisUnitId=" + quoteData(context.analysisUnitId()) + "\n");
        writer.appendRequired("file=" + quoteData(context.fileName()) + "\n");
        writer.appendRequired("battleIdentity=" + quoteData(context.battleId()) + "\n");
        writer.appendRequired("category=" + context.battleCategory() + "\n");
        if (context.battle() != null) {
            final String teamLabel = resolvePerspectiveLabel(
                    context.battle().players, context.perspectiveTeam());
            writer.appendRequired("teamLabel=" + quoteData(teamLabel) + "\n");
            writer.appendRequired("map=" + quoteData(resolveMapName(context.battle().mapName)) + "\n");
            writer.appendRequired("durationSec=" + formatNullable(
                    context.battle().durationS) + "\n");
            final String result = resolveTeamResult(
                    context.battle().winnerTeam, context.perspectiveTeam());
            writer.appendRequired("result=" + result + "\n");
        }
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
        final int memberLimit = Math.min(members.size(), MAX_MEMBERS);
        if (members.size() > memberLimit) {
            writer.markTruncated();
        }
        for (int index = 0; index < memberLimit; index++) {
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
        final int memberLimit = Math.min(members.size(), MAX_MEMBERS);
        boolean hasMovements = false;
        for (int index = 0; index < memberLimit; index++) {
            if (!members.get(index).movements().isEmpty()) {
                hasMovements = true;
                break;
            }
        }
        if (!hasMovements) return;
        writer.append("\n=== MEMBER_MOVEMENTS ===\n");
        for (int index = 0; index < memberLimit; index++) {
            final TeamMemberFeatureSet member = members.get(index);
            if (member.movements().isEmpty()) continue;
            final int movementLimit = Math.min(
                    member.movements().size(), MAX_MOVEMENTS_PER_MEMBER);
            if (member.movements().size() > movementLimit) {
                writer.markTruncated();
            }
            for (int movementIndex = 0; movementIndex < movementLimit; movementIndex++) {
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
        final int limit = Math.min(phases.size(), MAX_FORMATION_PHASES);
        if (phases.size() > limit) {
            writer.markTruncated();
        }
        for (int index = 0; index < limit; index++) {
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
        final int limit = Math.min(engagements.size(), MAX_ENGAGEMENTS);
        if (engagements.size() > limit) {
            writer.markTruncated();
        }
        for (int index = 0; index < limit; index++) {
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
        final int limit = Math.min(events.size(), MAX_KEY_EVENTS);
        if (events.size() > limit) {
            writer.markTruncated();
        }
        for (int index = 0; index < limit; index++) {
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

    private static String buildHighPriorityBlock(final TeamBattleFeatureSet features, final String analysisUnitId) {
        final BudgetWriter temp = new BudgetWriter(Integer.MAX_VALUE);
        appendHighPriorityFacts(temp, features, analysisUnitId);
        return temp.content();
    }

    private static String buildOptionalBlock(final TeamBattleFeatureSet features, final String analysisUnitId) {
        final BudgetWriter temp = new BudgetWriter(Integer.MAX_VALUE);
        appendOptionalDetails(temp, features, analysisUnitId);
        return temp.content();
    }

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
        final BudgetWriter hpfTemp = new BudgetWriter(Integer.MAX_VALUE);
        appendHighPriorityFacts(hpfTemp, perspective.features(), perspective.analysisUnitId());
        final String hpfContent = hpfTemp.content();
        final boolean hpfTruncated = hpfTemp.isTruncated();
        final BudgetWriter optTemp = new BudgetWriter(Integer.MAX_VALUE);
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

    /** Resolve map internal code to user-visible Chinese name via MapNames. */
    private static String resolveMapName(final String mapCode) {
        if (!StringUtils.hasText(mapCode)) return "未知地图";
        try {
            return MapNames.tryResolve(mapCode).orElse("未知地图");
        } catch (final Exception e) {
            return "未知地图";
        }
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
        final int limit = Math.min(phases.size(), MAX_BATTLE_PHASES);
        if (phases.size() > limit) {
            writer.markTruncated();
        }
        for (int index = 0; index < limit; index++) {
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

    /** Resolve tank name via Tankopedia (authoritative), falling back to unknown tank. */
    private static final Tankopedia TANKOPEDIA = Tankopedia.load();

    private static String resolveTankName(final long tankId, final String existingTankName) {
        // Tankopedia is the authoritative source for tank names
        if (tankId > 0) {
            final String name = TANKOPEDIA.info(tankId).name();
            if (StringUtils.hasText(name) && !name.startsWith("#")) {
                return name;
            }
        }
        // Fall back to existing tank name if it looks reasonable
        if (StringUtils.hasText(existingTankName)
                && !existingTankName.startsWith("#")
                && !existingTankName.startsWith("?")) {
            return existingTankName;
        }
        return "未知坦克";
    }

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

    private static final class BudgetWriter {

        private final int maxChars;
        private final StringBuilder content = new StringBuilder(4096);
        private int reserved;
        private boolean truncated;

        private BudgetWriter(final int maxChars) {
            this.maxChars = maxChars;
        }

        private void reserve(final int bytes) {
            this.reserved += bytes;
        }

        private void release(final int bytes) {
            this.reserved -= bytes;
        }

        private boolean append(final String value) {
            if (value == null || value.isEmpty()) {
                return true;
            }
            final int truncationReserve = TRUNCATION_LINE.length();
            final int remaining = maxChars - truncationReserve - reserved - content.length();
            if (remaining <= 0) {
                truncated = true;
                return false;
            }
            if (value.length() > remaining) {
                truncated = true;
                return false;
            }
            content.append(value);
            return true;
        }

        private void appendRequired(final String value) {
            if (!StringUtils.hasText(value)) {
                return;
            }
            final int truncationReserve = TRUNCATION_LINE.length();
            final int remaining = maxChars - truncationReserve - reserved - content.length();
            if (remaining <= 0 || value.length() > remaining) {
                throw new AiPromptBudgetExceededException();
            }
            content.append(value);
        }

        private void appendRequiredBlock(final String block) {
            if (!StringUtils.hasText(block)) return;
            final int truncationReserve = TRUNCATION_LINE.length();
            final int remaining = maxChars - truncationReserve - reserved - content.length();
            if (remaining <= 0 || block.length() > remaining) {
                throw new AiPromptBudgetExceededException();
            }
            content.append(block);
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

        private PromptInput finish(final Set<String> suppliedGlobalLimitations, final Set<String> includedIds, final Set<String> omittedIds, final Set<String> truncatedIds, final Map<String, List<String>> perUnitLimitations) {
            final Set<String> globalLimitations = new LinkedHashSet<>(suppliedGlobalLimitations);
            if (truncated) {
                globalLimitations.add("AI_INPUT_TRUNCATED");
                content.append(TRUNCATION_LINE);
            }
            return new PromptInput(content.toString(), includedIds, omittedIds, truncatedIds, perUnitLimitations, new ArrayList<>(globalLimitations));
        }
    }
}
