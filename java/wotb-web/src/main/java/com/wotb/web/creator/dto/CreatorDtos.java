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

public final class CreatorDtos {
    private CreatorDtos() { }

    public record Category(long id, String name) { }
    public record Level(long id, String name) { }
    public record Card(long id, String name, String description, String homepageUrl, String avatarUrl,
                       List<Category> categories, Level level, int score, long favoriteCount, Instant createdAt) { }
    public record Detail(long id, String name, String description, String homepageUrl, List<Long> categoryIds,
                         Long levelId, int baseStars, String avatarId, String avatarUrl) { }
    public record Favorites(List<Long> creatorIds) { }
    public record FavoriteResult(Card creator, boolean active) { }
    public record Settings(int favoriteThreshold, boolean avatarUploadsAvailable) { }
    public record Avatar(String id, String url) { }
    public record SaveRequest(
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String description,
            @JsonProperty(required = true) String homepageUrl,
            @JsonProperty(required = true) @JsonDeserialize(contentUsing = JsonNumberInputs.LongInput.class) List<Long> categoryIds,
            @JsonProperty(required = true) @JsonDeserialize(using = JsonNumberInputs.LongInput.class) Long levelId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int baseStars,
            @JsonProperty(required = true) String avatarId
    ) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw invalid(); }
    }
    public record DictionaryRequest(@JsonProperty(required = true) String name) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw invalid(); }
    }
    public record SettingsRequest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) @JsonDeserialize(using = JsonNumberInputs.IntegerInput.class) int favoriteThreshold
    ) {
        @JsonAnySetter
        public void rejectUnknown(final String key, final Object value) { throw invalid(); }
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
}
