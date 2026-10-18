package com.wotb.web.tournament.dto;

import com.wotb.web.util.JsonNumberInputs;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import tools.jackson.databind.annotation.JsonDeserialize;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import java.time.format.DateTimeParseException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Wire shapes owned by contracts/http/openapi.yaml. */
public final class BroadcastDtos {
    private BroadcastDtos() { }
    public record Season(long id, String server, int year, String nameZh, String nameEn, String nameRu, LocalDate startDate,
                         Instant createdAt, long version, long rootCount, long replayCount) { }
    public record Category(long id, long seasonId, String type) { }
    public record Replay(long id, long nodeId, String title, String url, LocalDate matchDate, int dayNumber,
                         Integer groupNumber, String bracket, List<String> teams,
                         String perspective, String coverId) { }
    public record Node(long id, long categoryId, Integer roundNumber, String format, List<Replay> replays) { }
    public record Index(List<String> servers, List<Season> seasons, boolean coverUploadAvailable) { }
    public record SeasonView(Season season, List<Category> categories, boolean coverUploadAvailable) { }
    public record CategoryView(Season season, Category category, List<Node> nodes, boolean coverUploadAvailable) { }
    public record ReplayStart(long replayId, Instant startsAt) { }
    public record TimedCategoryView(CategoryView data, String defaultTimeZone, List<ReplayStart> replayStarts) { }
    public record TimedReplaySave(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) ReplaySave replay,
            @JsonProperty(required = true) @JsonDeserialize(using = StartInstantInput.class) Instant startsAt) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
    /** Unlike Jackson's general Instant reader, this input accepts only an ISO date-time string or explicit null. */
    public static final class StartInstantInput extends ValueDeserializer<Instant> {
        @Override
        public Instant deserialize(final JsonParser parser, final DeserializationContext context) {
            if (!parser.hasToken(JsonToken.VALUE_STRING)) {
                return context.reportInputMismatch(Instant.class, "Expected an ISO date-time string");
            }
            try { return Instant.parse(parser.getString()); }
            catch (final DateTimeParseException failure) {
                return context.reportInputMismatch(Instant.class, "Expected an ISO date-time string with offset");
            }
        }
    }
    public record DeletionPreview(long seasonId, long expectedVersion, long rootCount, long replayCount) { }
    public record SeasonCreate(
            @JsonProperty(required = true) String server,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int year,
            @JsonProperty(required = true) String nameZh,
            @JsonProperty(required = true) String nameEn,
            String nameRu,
            @JsonProperty(required = true) LocalDate startDate) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
    public record SeasonUpdate(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) long expectedVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int year,
            @JsonProperty(required = true) String nameZh,
            @JsonProperty(required = true) String nameEn,
            String nameRu,
            @JsonProperty(required = true) LocalDate startDate) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
    public record CategoryCreate(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) long expectedVersion,
            @JsonProperty(required = true) String type) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
    public record NodeCreate(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) long expectedVersion,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) Integer roundNumber,
            @JsonProperty(required = true) String format) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
    public record ReplaySave(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) long expectedVersion,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) String url,
            @JsonProperty(required = true) LocalDate matchDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int dayNumber,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) Integer groupNumber,
            @JsonProperty(required = true) String bracket,
            @JsonProperty(required = true) List<String> teams,
            @JsonProperty(required = true) String perspective,
            @JsonProperty(required = true) String coverAction) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
}
