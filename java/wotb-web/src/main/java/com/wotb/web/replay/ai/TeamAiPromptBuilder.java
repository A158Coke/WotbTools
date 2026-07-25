package com.wotb.web.replay.ai;

import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MultiTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 将 Team Context 压缩为确定性、长度受限的 AI 输入。
 * 不接收或输出原始 ReplayEvent/逐帧位置流。
 */
final class TeamAiPromptBuilder {

    static final int MAX_MEMBERS = 15;
    static final int MAX_MOVEMENTS_PER_MEMBER = 6;
    static final int MAX_FORMATION_PHASES = 20;
    static final int MAX_ENGAGEMENTS = 20;
    static final int MAX_KEY_EVENTS = 30;
    static final int MAX_PERSPECTIVES = 10;
    static final int MAX_INPUT_CHARS = 30_000;
    private static final String TRUNCATION_LINE = "\nLIMITATION: AI_INPUT_TRUNCATED\n";

    private TeamAiPromptBuilder() {
    }

    static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        final BudgetWriter writer = new BudgetWriter(MAX_INPUT_CHARS);
        appendContextHeader(writer, context);
        appendFeatureSet(writer, context.features());
        final Set<String> limitations = new LinkedHashSet<>(context.limitations());
        if (context.features() != null) {
            limitations.addAll(context.features().limitations());
        }
        appendLimitations(writer, limitations);
        return writer.finish(limitations);
    }

    static PromptInput multi(final MultiTeamBattleAnalysisContext context) {
        final BudgetWriter writer = new BudgetWriter(MAX_INPUT_CHARS);
        final Set<String> limitations = new LinkedHashSet<>(context.limitations());
        writer.append("=== MULTI_TEAM_CONTEXT ===\n");
        writer.append("perspectiveCount=" + context.perspectiveCount() + "\n");
        writer.append("rosterConsistent=" + context.rosterConsistent() + "\n");
        final List<TeamBattleAnalysisSummary> perspectives = context.perspectives();
        final int perspectiveLimit = Math.min(perspectives.size(), MAX_PERSPECTIVES);
        if (perspectives.size() > perspectiveLimit) {
            writer.markTruncated();
        }
        for (int index = 0; index < perspectiveLimit; index++) {
            final TeamBattleAnalysisSummary perspective = perspectives.get(index);
            writer.append("\n=== PERSPECTIVE " + (index + 1) + " ===\n");
            writer.append("analysisUnitId=" + quoteData(perspective.analysisUnitId()) + "\n");
            writer.append("file=" + quoteData(perspective.fileName()) + "\n");
            writer.append("battleIdentity=" + quoteData(perspective.battleIdentity()) + "\n");
            writer.append("map=" + quoteData(perspective.mapName()) + "\n");
            writer.append("category=" + perspective.battleCategory() + "\n");
            writer.append("durationSec=" + formatNullable(
                    perspective.durationSec()) + "\n");
            writer.append("perspectiveTeam=" + perspective.perspectiveTeam() + "\n");
            writer.append("rosterAccountIds=" + perspective.rosterAccountIds() + "\n");
            appendFeatureSet(writer, perspective.features());
            if (perspective.features() != null) {
                limitations.addAll(perspective.features().limitations());
            }
        }
        if (!context.rosterConsistent()) {
            limitations.add("ROSTER_CONSISTENCY_UNCONFIRMED");
        }
        appendLimitations(writer, limitations);
        return writer.finish(limitations);
    }

    private static void appendContextHeader(
            final BudgetWriter writer,
            final SingleTeamBattleAnalysisContext context
    ) {
        writer.append("=== SINGLE_TEAM_CONTEXT ===\n");
        writer.append("analysisUnitId=" + quoteData(context.analysisUnitId()) + "\n");
        writer.append("file=" + quoteData(context.fileName()) + "\n");
        writer.append("battleIdentity=" + quoteData(context.battleId()) + "\n");
        writer.append("category=" + context.battleCategory() + "\n");
        writer.append("perspectiveTeam=" + context.perspectiveTeam() + "\n");
        if (context.battle() != null) {
            writer.append("map=" + quoteData(context.battle().mapName) + "\n");
            writer.append("durationSec=" + formatNullable(
                    context.battle().durationS) + "\n");
            writer.append("winnerTeam=" + formatScalar(context.battle().winnerTeam) + "\n");
        }
    }

    private static void appendFeatureSet(
            final BudgetWriter writer,
            final TeamBattleFeatureSet features
    ) {
        if (features == null) {
            writer.append("features=UNAVAILABLE\n");
            return;
        }
        appendAuthoritative(writer, features.authoritativeAggregate());
        appendObserved(writer, features.observedAggregate());
        appendMembers(writer, features.members());
        appendFormation(writer, features.formationPhases());
        appendEngagements(writer, features.engagements());
        appendKeyEvents(writer, features.keyEvents());
        writer.append("coverage=" + features.coverage() + "\n");
        if (!features.limitations().isEmpty()) {
            writer.append("featureLimitations=" + features.limitations() + "\n");
        }
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

    private static void appendMembers(
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
                    + " tank=" + quoteData(member.tankName())
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
            final int movementLimit = Math.min(
                    member.movements().size(), MAX_MOVEMENTS_PER_MEMBER);
            if (member.movements().size() > movementLimit) {
                writer.markTruncated();
            }
            for (int movementIndex = 0; movementIndex < movementLimit; movementIndex++) {
                final MovementSegment movement = member.movements().get(movementIndex);
                writer.append("  movement[" + format(movement.startTime())
                        + "-" + format(movement.endTime()) + "]"
                        + " type=" + movement.type()
                        + " distance=" + format(movement.distance())
                        + " avgSpeed=" + format(movement.averageSpeed())
                        + " startXZ=" + formatPosition(movement.startPosition())
                        + " endXZ=" + formatPosition(movement.endPosition())
                        + " confidence=" + movement.confidence()
                        + "\n");
            }
            if (!member.limitations().isEmpty()) {
                writer.append("  memberLimitations=" + member.limitations() + "\n");
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
            writer.append("formation[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " centroid=" + phase.centroid()
                    + " dispersion=" + format(phase.averageDispersion())
                    + " clusters=" + phase.clusterCount()
                    + " members=" + phase.observedMemberCount()
                    + " confidence=" + phase.confidence()
                    + "\n");
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

    private static void appendLimitations(
            final BudgetWriter writer,
            final Set<String> limitations
    ) {
        writer.append("\n=== DATA_LIMITATIONS ===\n");
        limitations.forEach(limitation ->
                writer.append("- " + quoteData(limitation) + "\n"));
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
        final String text = value == null ? "UNKNOWN" : String.valueOf(value);
        final StringBuilder quoted = new StringBuilder(text.length() + 2);
        quoted.append('"');
        for (int index = 0; index < text.length(); index++) {
            final char character = text.charAt(index);
            switch (character) {
                case '"' -> quoted.append("\\\"");
                case '\\' -> quoted.append("\\\\");
                case '\b' -> quoted.append("\\b");
                case '\f' -> quoted.append("\\f");
                case '\n' -> quoted.append("\\n");
                case '\r' -> quoted.append("\\r");
                case '\t' -> quoted.append("\\t");
                default -> {
                    if (character < 0x20) {
                        quoted.append(String.format(
                                Locale.ROOT, "\\u%04x", (int) character));
                    } else {
                        quoted.append(character);
                    }
                }
            }
        }
        return quoted.append('"').toString();
    }

    private static String format(final double value) {
        return String.format(Locale.ROOT, "%.1f", value);
    }

    private static String formatNullable(final Double value) {
        return value == null || !Double.isFinite(value)
                ? "UNKNOWN" : format(value);
    }

    private static String formatPosition(final Vector3 position) {
        return position == null
                ? "UNKNOWN"
                : "(" + format(position.x()) + "," + format(position.z()) + ")";
    }

    record PromptInput(String content, List<String> limitations) {

        PromptInput {
            limitations = limitations == null ? List.of() : List.copyOf(limitations);
        }
    }

    private static final class BudgetWriter {

        private final int maxChars;
        private final StringBuilder content = new StringBuilder(4096);
        private boolean truncated;

        private BudgetWriter(final int maxChars) {
            this.maxChars = maxChars;
        }

        private void append(final String value) {
            if (value == null || value.isEmpty()) {
                return;
            }
            final int reserve = TRUNCATION_LINE.length();
            final int remaining = maxChars - reserve - content.length();
            if (remaining <= 0) {
                truncated = true;
                return;
            }
            if (value.length() > remaining) {
                truncated = true;
                return;
            }
            content.append(value);
        }

        private void markTruncated() {
            truncated = true;
        }

        private PromptInput finish(final Set<String> suppliedLimitations) {
            final Set<String> limitations = new LinkedHashSet<>(suppliedLimitations);
            if (truncated) {
                limitations.add("AI_INPUT_TRUNCATED");
                final int maximumBaseLength = Math.max(0, maxChars - TRUNCATION_LINE.length());
                if (content.length() > maximumBaseLength) {
                    content.setLength(maximumBaseLength);
                }
                content.append(TRUNCATION_LINE);
            }
            return new PromptInput(content.toString(), new ArrayList<>(limitations));
        }
    }
}
