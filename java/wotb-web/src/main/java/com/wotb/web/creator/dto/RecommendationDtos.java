package com.wotb.web.creator.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.wotb.web.util.JsonNumberInputs;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.Instant;
import java.util.List;

/** New neutral wire boundary; legacy CreatorDtos remains UP-only and unchanged. */
public final class RecommendationDtos {
    private RecommendationDtos() { }
    public record Category(long id, String name, String type) { }
    public record Card(long id, long version, String type, String externalId, String name, String description,
                       String targetUrl, String imageUrl, List<Category> categories, CreatorDtos.Level level,
                       int score, Instant createdAt) { }
    public record Detail(long id, long version, String type, String externalId, String name, String description,
                         List<Long> categoryIds, Long levelId, int stars, String imageUrl) { }
    public record Metadata(String type, List<Category> categories, List<CreatorDtos.Level> levels,
                           boolean imageUploadsAvailable) { }
    public record SaveRequest(
            @JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String type,
            @JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String externalId,
            @JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String name,
            @JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String description,
            @JsonProperty(required = true) @JsonDeserialize(contentUsing = JsonNumberInputs.LongInput.class) List<Long> categoryIds,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long levelId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int stars,
            @JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String imageAction,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long expectedVersion
    ) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    }
    public record CategoryRequest(@JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String type, @JsonProperty(required = true) @JsonDeserialize(using = CreatorDtos.UidInput.class) String name) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    }
}
