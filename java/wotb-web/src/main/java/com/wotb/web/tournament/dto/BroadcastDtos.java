package com.wotb.web.tournament.dto;

import com.wotb.web.util.JsonNumberInputs;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Wire shapes owned by contracts/http/openapi.yaml. */
public final class BroadcastDtos {
    private BroadcastDtos() { }
    public record Season(long id, String server, int year, String name, LocalDate startDate,
                         Instant createdAt, long version, long rootCount, long replayCount) { }
    public record Category(long id, long seasonId, String type) { }
    public record Replay(long id, long nodeId, String title, String url, LocalDate matchDate, int dayNumber,
                         String groupLabel, Integer groupNumber, String bracket, List<String> teams,
                         String perspective, String coverId) { }
    public record Node(long id, long categoryId, Integer roundNumber, String format, List<Replay> replays) { }
    public record Index(List<String> servers, List<Season> seasons, boolean coverUploadAvailable) { }
    public record SeasonView(Season season, List<Category> categories, boolean coverUploadAvailable) { }
    public record CategoryView(Season season, Category category, List<Node> nodes, boolean coverUploadAvailable) { }
    public record DeletionPreview(long seasonId, long expectedVersion, long rootCount, long replayCount) { }
    public record SeasonCreate(
            @JsonProperty(required = true) String server,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int year,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) LocalDate startDate) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
    public record SeasonUpdate(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) long expectedVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int year,
            @JsonProperty(required = true) String name,
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
            @JsonProperty(required = true) String groupLabel,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) Integer groupNumber,
            @JsonProperty(required = true) String bracket,
            @JsonProperty(required = true) List<String> teams,
            @JsonProperty(required = true) String perspective,
            @JsonProperty(required = true) String coverAction) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected broadcast request property"); }
    }
}
