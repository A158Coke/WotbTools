package com.wotb.web.tournament.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.Nulls;
import com.wotb.web.util.JsonNumberInputs.IntegerInput;
import com.wotb.web.util.JsonNumberInputs.LongInput;
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
    public record DefaultRound(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int roundNumber,
            @JsonProperty(required = true) List<RuleDay> days
    ) { }
    public record DefaultConfigurationRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDefaultVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean confirm,
            @JsonProperty(required = true) List<DefaultRound> rounds
    ) { }
    public record DefaultRules(long version, boolean active, Long sourceEventId, String sourceLabel,
                               Instant updatedAt, List<DefaultRound> rounds) { }
    public record RuleSource(long eventVersion, String source, Long defaultVersion,
                             boolean isDefaultSource, boolean defaultOutdated) { }
    public record SetDefaultRulesRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long eventId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDefaultVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean confirm
    ) { }
    public record ClearDefaultRulesRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedDefaultVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean confirm
    ) { }
    public record RuleRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedEventVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = LongInput.class) long expectedRulesVersion,
            @JsonProperty(required = true) List<RuleDay> days,
            @JsonDeserialize(using = LongInput.class) Long expectedDefaultVersion
    ) {
        public RuleRequest(final long eventVersion, final long rulesVersion, final List<RuleDay> days) {
            this(eventVersion, rulesVersion, days, null);
        }
    }
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
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = IntegerInput.class) int expectedGroupCount,
            @JsonDeserialize(using = LongInput.class) Long expectedDefaultVersion
    ) {
        public ExpectedGroupsRequest(final long eventVersion, final long dayVersion, final int count) {
            this(eventVersion, dayVersion, count, null);
        }
    }
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
            Standings standings,
            @JsonInclude(JsonInclude.Include.NON_NULL)
            Standings canonicalStandings
    ) { }
    public record HistoricalState(long eventVersion, boolean imported, boolean canImport, boolean historical) { }
    public record Attribution(String name, String url) { }
    public record DataSource(boolean csvImported, Attribution attribution) { }
    public record CsvChanges(int addedClans, int changedClans, int removedClans,
                             int addedScores, int changedScores, int removedScores, int preservedClears) { }
    public record CsvImportPreview(Standings standings, String sourceName, String sourceSha256,
                                   int sourceRowCount, int clanCount, int missingCellCount,
                                   long eventVersion, CsvChanges changes) { }
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
}
