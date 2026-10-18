package com.wotb.web.creator.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.wotb.web.util.JsonNumberInputs;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import tools.jackson.databind.annotation.JsonDeserialize;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import java.time.Instant;
import java.util.List;

/** Typed wire boundary for UP and video recommendations. */
public final class RecommendationDtos {
    private RecommendationDtos() { }
    public record Level(long id, String name) { }
    public record Category(long id, String name, String type) { }
    public record Card(long id, long version, String type, String externalId, String name, String description,
                       String targetUrl, String imageUrl, List<Category> categories, Level level,
                       int score, Instant createdAt) { }
    public record Detail(long id, long version, String type, String externalId, String name, String description,
                         List<Long> categoryIds, Long levelId, int stars, String imageUrl) { }
    public record Metadata(String type, List<Category> categories, List<Level> levels,
                           boolean imageUploadsAvailable) { }
    public record SaveRequest(
            @JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String type,
            @JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String externalId,
            @JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String name,
            @JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String description,
            @JsonProperty(required = true) @JsonDeserialize(contentUsing = JsonNumberInputs.LongInput.class) List<Long> categoryIds,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long levelId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int stars,
            @JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String imageAction,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long expectedVersion
    ) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    }
    public record CategoryRequest(@JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String type, @JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String name) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    }
    public record DictionaryRequest(@JsonProperty(required = true) @JsonDeserialize(using = StringInput.class) String name) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    }
    /** Never coerce a JSON scalar: large Bilibili IDs must survive transport exactly. */
    public static class StringInput extends ValueDeserializer<String> {
        @Override
        public String deserialize(final JsonParser parser, final DeserializationContext context) {
            if (parser.hasToken(JsonToken.VALUE_STRING)) { return parser.getString(); }
            return context.reportInputMismatch(String.class, "Expected a JSON string");
        }
    }
}
