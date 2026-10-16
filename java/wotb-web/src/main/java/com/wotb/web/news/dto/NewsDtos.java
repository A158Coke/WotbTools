package com.wotb.web.news.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.web.util.ExactLongInput;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.Instant;
import java.util.List;

/** News HTTP shapes; contracts/http/openapi.yaml owns the serialized contract. */
public final class NewsDtos {
    private NewsDtos() { }
    public record Source(String id, boolean enabled) { }
    public record Category(long id, String name, String type) { }
    public record Block(String id, String html) { }
    public record Sync(Instant lastSuccessfulFetchAt, Instant nextRefreshAt, boolean stale) { }
    public record Article(String sourceKey, String title, String sourceUrl, String language,
                          String publishedAtRaw, String coverImageId, String revision, List<Block> blocks, Sync sync) { }
    public record ArticlePage(List<Article> items, int page, int size, long totalItems, Sync sync) { }
    public record Archive(long id, String source, String version, String title, String status, long revision,
                          List<Category> categories, List<Article> articles, Instant createdAt,
                          String reviewedBy, Instant publishedAt, String errorCode) { }
    public record ArchiveSummary(long id, String source, String version, String title, String status, long revision,
                                 List<Category> categories, Instant createdAt, String reviewedBy,
                                 Instant publishedAt, String errorCode) { }
    public record ArchivePage(List<ArchiveSummary> items, int page, int size, long totalItems) { }
    public record Selection(@JsonProperty(required = true) String sourceKey,
                            @JsonProperty(required = true) String revision,
                            @JsonProperty(required = true) List<String> blockIds) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected news property"); }
    }
    public record Draft(@JsonProperty(required = true) String version,
                        @JsonProperty(required = true) String title,
                        @JsonProperty(required = true) @JsonDeserialize(contentUsing = ExactLongInput.class) List<Long> categoryIds,
                        @JsonProperty(required = true) List<Selection> articles) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected news property"); }
    }
    public record CreateRequest(@JsonProperty(required = true) String idempotencyKey,
                                @JsonProperty(required = true) List<Draft> archives) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected news property"); }
    }
    public record ReceiptResult(List<Long> archiveIds, List<Long> deletedIds) { }
    public record RevisionRequest(@JsonProperty(required = true) @JsonDeserialize(using = ExactLongInput.class) Long expectedRevision) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected news property"); }
    }
    public record CategoryCreate(@JsonProperty(required = true) String name, @JsonProperty(required = true) String type) {
        @JsonAnySetter public void unknown(final String name, final Object value) { throw new IllegalArgumentException("Unexpected news property"); }
    }
}
