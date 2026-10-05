package com.wotb.web.tournament.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Explicit HTTP shapes; persisted snapshots are separate domain records. */
public final class TournamentDtos {
    private TournamentDtos() { }
    public record Event(
            long id,
            long version,
            int year,
            String region,
            String season,
            int roundCount,
            int daysPerRound,
            List<String> dayLabels,
            boolean configLocked
    ) { }
    public record CreateRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int year,
            @JsonProperty(required = true) String region,
            @JsonProperty(required = true) String season,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int roundCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int daysPerRound,
            @JsonProperty(required = true) List<String> dayLabels
    ) { }
    public record UpdateRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int year,
            @JsonProperty(required = true) String region,
            @JsonProperty(required = true) String season,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int roundCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int daysPerRound,
            @JsonProperty(required = true) List<String> dayLabels
    ) { }
    public record RankPoints(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int rank,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int points
    ) { }
    public record RuleDay(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int dayNumber,
            @JsonProperty(required = true) List<RankPoints> points
    ) { }
    public record RoundRule(
            int roundNumber,
            long rulesVersion,
            boolean complete,
            boolean locked,
            List<RuleDay> days
    ) { }
    public record Config(
            Event event,
            List<RoundRule> rounds,
            List<String> clans
    ) { }
    public record RuleRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedRulesVersion,
            @JsonProperty(required = true) List<RuleDay> days
    ) { }
    public record Team(
            @JsonProperty(required = true) String clanTag,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int rank
    ) { }
    public record Group(
            int groupNumber,
            String evidenceId,
            String imageHash,
            List<Team> teams
    ) { }
    public record IncomingGroup(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int groupNumber,
            @JsonProperty(required = true) String evidenceId,
            @JsonProperty(required = true) String imageHash,
            @JsonProperty(required = true) List<Team> teams,
            @JsonProperty(required = true) String duplicateAction,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean complete
    ) { }
    public record Versions(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDayVersion
    ) { }
    public record ExpectedGroupsRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDayVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int expectedGroupCount
    ) { }
    public record DraftRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDayVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedRulesVersion,
            @JsonProperty(required = true) List<IncomingGroup> groups,
            @JsonProperty(required = true) List<String> confirmedNewClans
    ) { }
    public record FinalizeRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDayVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedRulesVersion,
            @JsonProperty(required = true) String idempotencyKey
    ) { }
    public record CorrectionRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDayVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int expectedGroupCount,
            @JsonProperty(required = true) String reason
    ) { }
    public record ClearRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int roundNumber,
            @JsonProperty(required = true) @JsonDeserialize(using = IntegerInput.class) Integer dayNumber,
            @JsonProperty(required = true) String clanTag,
            @JsonProperty(required = true) String reason,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean restore
    ) { }
    public record DeleteRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean confirm
    ) { }
    public record DayPoints(
            int dayNumber,
            Long points
    ) { }
    public record RoundPoints(
            int roundNumber,
            long totalPoints,
            List<DayPoints> days
    ) { }
    public record StandingRow(
            int rank,
            String clanTag,
            long totalPoints,
            List<RoundPoints> rounds
    ) { }
    public record StandingDay(
            int roundNumber,
            int dayNumber,
            String label,
            boolean published
    ) { }
    public record Standings(
            Event event,
            List<StandingDay> days,
            List<StandingRow> rows
    ) { }
    public record DayView(
            long eventId,
            int roundNumber,
            int dayNumber,
            long eventVersion,
            long rulesVersion,
            long version,
            String status,
            Integer expectedGroupCount,
            List<Group> groups,
            boolean published,
            Standings standings
    ) { }
    public record HistoricalState(long eventVersion, boolean imported, boolean canImport, boolean historical) { }
    public record HistoricalRow(
            @JsonProperty(required = true) String clanTag,
            @JsonProperty(required = true) @JsonDeserialize(contentUsing = IntegerInput.class) List<Integer> points,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long sourceTotal
    ) { }
    public record HistoricalPreviewRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) String sourceName,
            @JsonProperty(required = true) String sourceSha256,
            @JsonProperty(required = true) List<HistoricalRow> rows
    ) { }
    public record HistoricalImportRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) String sourceName,
            @JsonProperty(required = true) String sourceSha256,
            @JsonProperty(required = true) List<HistoricalRow> rows,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean confirm,
            @JsonProperty(required = true) String idempotencyKey
    ) { }
    public record HistoricalPreview(
            Standings standings,
            int sourceRowCount,
            int clanCount,
            int missingCellCount,
            long eventVersion
    ) { }
    public record RecognitionPermit(
            String permit,
            Instant expiresAt,
            String evidenceId,
            String imageHash
    ) { }
    public record Audit(
            long id,
            String action,
            String actor,
            String reason,
            Integer roundNumber,
            Integer dayNumber,
            Instant createdAt,
            Map<String, Object> before,
            Map<String, Object> after
    ) { }
    public record EvidenceDownload(
            byte[] bytes,
            String contentType
    ) { }
    /** Native Jackson property readers keep decimal input exact and reject numeric strings. */
    public static class IntegerInput extends ValueDeserializer<Integer> {
        @Override
        public Integer deserialize(final JsonParser parser, final DeserializationContext context) {
            if (parser.hasToken(JsonToken.VALUE_NUMBER_INT)) { return parser.getIntValue(); }
            if (parser.hasToken(JsonToken.VALUE_NUMBER_FLOAT)) {
                try { return parser.getDecimalValue().intValueExact(); }
                catch (final ArithmeticException invalid) { return context.reportInputMismatch(Integer.class, "Expected an exact integer"); }
            }
            return context.reportInputMismatch(Integer.class, "Expected an integer JSON number");
        }
    }
    public static class LongInput extends ValueDeserializer<Long> {
        @Override
        public Long deserialize(final JsonParser parser, final DeserializationContext context) {
            if (parser.hasToken(JsonToken.VALUE_NUMBER_INT)) { return parser.getLongValue(); }
            if (parser.hasToken(JsonToken.VALUE_NUMBER_FLOAT)) {
                try { return parser.getDecimalValue().longValueExact(); }
                catch (final ArithmeticException invalid) { return context.reportInputMismatch(Long.class, "Expected an exact integer"); }
            }
            return context.reportInputMismatch(Long.class, "Expected an integer JSON number");
        }
    }
}
