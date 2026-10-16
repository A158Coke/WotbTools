package com.wotb.web.creator.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.wotb.web.util.JsonNumberInputs;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.Instant;
import java.util.List;

public final class CreatorDtos {
    private CreatorDtos() { }
    public record Category(long id, String name) { }
    public record Level(long id, String name) { }
    public record Card(long id, long version, String bilibiliUid, String name, String description, String homepageUrl,
                       String avatarUrl, List<Category> categories, Level level, int score, Instant createdAt) { }
    public record Detail(long id, long version, String bilibiliUid, String name, String description, List<Long> categoryIds,
                         Long levelId, int stars, String avatarUrl) { }
    public record Metadata(List<Category> categories, List<Level> levels, boolean avatarUploadsAvailable) { }
    public record SaveRequest(
            @JsonProperty(required = true) @JsonDeserialize(using = UidInput.class) String bilibiliUid,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String description,
            @JsonProperty(required = true) @JsonDeserialize(contentUsing = JsonNumberInputs.LongInput.class) List<Long> categoryIds,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long levelId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int stars,
            @JsonProperty(required = true) String avatarAction,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long expectedVersion
    ) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw invalid(); }
    }
    public record DictionaryRequest(@JsonProperty(required = true) String name) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw invalid(); }
    }
    /** Never coerce a JSON number: large Bilibili IDs must survive browser transport exactly. */
    public static class UidInput extends ValueDeserializer<String> {
        @Override
        public String deserialize(final JsonParser parser, final DeserializationContext context) {
            if (parser.hasToken(JsonToken.VALUE_STRING)) { return parser.getString(); }
            return context.reportInputMismatch(String.class, "Expected a UID JSON string");
        }
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
}
