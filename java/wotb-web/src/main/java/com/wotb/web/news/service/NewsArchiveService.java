package com.wotb.web.news.service;

import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.entity.NewsArchive;
import com.wotb.web.news.entity.NewsArchiveSource;
import com.wotb.web.news.entity.NewsCategory;
import com.wotb.web.news.entity.NewsReceipt;
import com.wotb.web.news.mapper.NewsMapper;
import com.wotb.web.news.repository.NewsArchiveRepository;
import com.wotb.web.news.repository.NewsArchiveSourceRepository;
import com.wotb.web.news.repository.NewsCategoryRepository;
import com.wotb.web.news.repository.NewsReceiptRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Frozen review snapshots, durable idempotency and database-fenced preparation attempts. */
@Service
public class NewsArchiveService {
    private static final int MAX_BATCH = 10;
    private static final int MAX_ARTICLES = 20;
    private static final int MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
    private static final int MAX_BATCH_BYTES = 16 * 1024 * 1024;
    private static final int MAX_IMAGES = 120;
    private static final Duration PREPARATION_LEASE = Duration.ofMinutes(5);
    private final NewsArchiveRepository archives;
    private final NewsArchiveSourceRepository archiveSources;
    private final NewsCategoryRepository categories;
    private final NewsReceiptRepository receipts;
    private final NewsSourceService sources;
    private final NewsMapper mapper;
    private final ObjectMapper json;
    private final TransactionTemplate transaction;

    public NewsArchiveService(final NewsArchiveRepository archives, final NewsArchiveSourceRepository archiveSources,
                              final NewsCategoryRepository categories, final NewsReceiptRepository receipts,
                              final NewsSourceService sources, final NewsMapper mapper, final ObjectMapper json,
                              final PlatformTransactionManager transactions) {
        this.archives = archives; this.archiveSources = archiveSources; this.categories = categories;
        this.receipts = receipts; this.sources = sources; this.mapper = mapper; this.json = json;
        this.transaction = new TransactionTemplate(transactions);
    }

    /** Internal worker input. Image URLs are frozen before source cache eviction or source changes. */
    public record Work(long id, String attemptToken, Instant leaseUntil,
                       List<NewsDtos.Article> articles, Map<String, String> imageSources) { }
    private record Selected(NewsDtos.Article article, Map<String, String> images) { }

    public NewsDtos.ReceiptResult create(final String operator, final NewsDtos.CreateRequest request) {
        final NewsDtos.CreateRequest normalized = normalized(request);
        final String actor = text(operator, 255);
        final String receiptId = actor + "/" + normalized.idempotencyKey();
        final String payloadHash = hash(json.writeValueAsString(normalized.archives()));
        final NewsDtos.ReceiptResult prior = transaction.execute(tx -> receipts.findById(receiptId)
                .map(receipt -> result(receipt, payloadHash)).orElse(null));
        if (prior != null) { return prior; }
        // Source validation does no network I/O. No database locks are held while copying snapshots.
        final List<List<Selected>> selected;
        try {
            selected = normalized.archives().stream().map(draft -> draft.articles().stream().map(selection -> {
                final NewsDtos.Article article = mapper.snapshot(sources.selected(selection));
                return new Selected(article, Map.copyOf(sources.imageSources(article)));
            }).toList()).toList();
        } catch (final ApiException e) {
            // A concurrent same-key request may have committed while the cached revision changed.
            final NewsDtos.ReceiptResult concurrent = transaction.execute(tx -> receipts.findById(receiptId)
                    .map(receipt -> result(receipt, payloadHash)).orElse(null));
            if (concurrent != null) { return concurrent; }
            throw e;
        }
        long batchBytes = 0;
        for (final List<Selected> draft : selected) {
            final long bytes = draft.stream().flatMap(selection -> selection.article().blocks().stream())
                    .mapToLong(block -> block.html().getBytes(StandardCharsets.UTF_8).length).sum();
            final long imageCount = draft.stream().flatMap(selection -> selection.images().keySet().stream()).distinct().count();
            batchBytes += bytes;
            if (bytes > MAX_ARCHIVE_BYTES || batchBytes > MAX_BATCH_BYTES || imageCount > MAX_IMAGES) {
                throw new ApiException(ApiErrorCode.FILE_TOO_LARGE);
            }
        }
        return transaction.execute(tx -> {
            final boolean inserted = receipts.reserve(receiptId, payloadHash) == 1;
            final NewsReceipt receipt = receipts.findLocked(receiptId).orElseThrow();
            if (!inserted) { return result(receipt, payloadHash); }
            final Map<Long, NewsCategory> lockedCategories = new HashMap<>();
            normalized.archives().stream().flatMap(draft -> draft.categoryIds().stream()).distinct().sorted()
                    .forEach(id -> lockedCategories.put(id, categories.findLocked(id)
                            .orElseThrow(() -> new ApiException(ApiErrorCode.INVALID_ARGUMENT))));
            final List<Long> ids = new ArrayList<>();
            for (int index = 0; index < normalized.archives().size(); index++) {
                final NewsDtos.Draft draft = normalized.archives().get(index);
                final List<NewsCategory> chosen = draft.categoryIds().stream().map(lockedCategories::get).toList();
                if (chosen.stream().filter(category -> "SPECIALIZED".equals(category.type)).count() > 1) {
                    throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
                }
                final NewsArchive archive = new NewsArchive();
                archive.source = "WG"; archive.version = draft.version(); archive.title = draft.title();
                archive.status = "PREPARING"; archive.createdAt = Instant.now(); archive.reviewedBy = actor;
                archive.categories.addAll(chosen);
                archives.saveAndFlush(archive);
                int position = 0;
                for (final Selected selection : selected.get(index)) {
                    final NewsArchiveSource source = new NewsArchiveSource();
                    source.archiveId = archive.id; source.position = position++;
                    source.article = selection.article(); source.imageSources = selection.images();
                    archiveSources.save(source);
                }
                ids.add(archive.id);
            }
            receipt.archiveIds = List.copyOf(ids);
            return new NewsDtos.ReceiptResult(List.copyOf(ids), List.of());
        });
    }

    @Transactional(readOnly = true)
    public NewsDtos.ArchivePage list(final int page, final int size, final String source,
                                     final String version, final boolean admin) {
        pagination(page, size);
        if (source != null && !"WG".equals(source)) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT); }
        final String filter = version == null ? null : text(version, 80);
        final var results = archives.browse(admin, filter, PageRequest.of(page - 1, size));
        return new NewsDtos.ArchivePage(results.stream().map(mapper::summary).toList(), page, size, results.getTotalElements());
    }

    @Transactional(readOnly = true)
    public NewsDtos.Archive get(final long id, final boolean admin) {
        final NewsArchive archive = archives.findById(id).orElseThrow(NewsArchiveService::missing);
        if (!admin && !"PUBLISHED".equals(archive.status)) { throw missing(); }
        return view(archive);
    }

    @Transactional(readOnly = true)
    public List<NewsDtos.Category> categories() { return categories.findAllByOrderByIdAsc().stream().map(mapper::toDto).toList(); }

    /** Internal authenticated-preview input; immutable URLs survive eviction of the source cache. */
    @Transactional(readOnly = true)
    public Map<String, String> frozenImageSources(final long id) {
        if (!archives.existsById(id)) { throw missing(); }
        return imageSources(archiveSources.findByArchiveIdOrderByPositionAsc(id));
    }

    @Transactional
    public NewsDtos.Category createCategory(final NewsDtos.CategoryCreate request) {
        if (request == null || !("GENERAL".equals(request.type()) || "SPECIALIZED".equals(request.type()))) {
            throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
        }
        final NewsCategory category = new NewsCategory();
        category.name = text(request.name(), 100); category.type = request.type();
        return mapper.toDto(categories.saveAndFlush(category));
    }

    @Transactional
    public void deleteCategory(final long id) {
        final NewsCategory category = categories.findLocked(id).orElseThrow(NewsArchiveService::missing);
        if (categories.referenced(id)) { throw new ApiException(ApiErrorCode.NEWS_CATEGORY_IN_USE); }
        categories.delete(category);
    }

    @Transactional
    public NewsDtos.Archive retry(final long id, final long expectedRevision) {
        final NewsArchive archive = editable(id, expectedRevision, "FAILED");
        archive.status = "PREPARING"; archive.errorCode = null; archive.attemptToken = null; archive.leaseUntil = null;
        archive.revision++;
        return view(archive);
    }

    @Transactional
    public NewsDtos.Archive withdraw(final long id, final long expectedRevision) {
        final NewsArchive archive = editable(id, expectedRevision, "PUBLISHED");
        archive.status = "WITHDRAWN"; archive.revision++;
        return view(archive);
    }

    /** Called only after the image service verifies COS bytes outside a database transaction. */
    @Transactional
    public NewsDtos.Archive restoreVerified(final long id, final long expectedRevision) {
        final NewsArchive archive = editable(id, expectedRevision, "WITHDRAWN");
        requireImagesReady(archive.id);
        archive.status = "PUBLISHED"; archive.revision++;
        return view(archive);
    }

    @Transactional
    public void delete(final long id, final long expectedRevision, final boolean confirm) {
        if (!confirm) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT); }
        final NewsArchive archive = locked(id);
        if (archive.revision != expectedRevision || !("FAILED".equals(archive.status) || "WITHDRAWN".equals(archive.status))) {
            throw conflict();
        }
        archives.markDetachedImages(id, Instant.now());
        archives.delete(archive);
        archives.flush();
    }

    @Transactional
    public Optional<Work> claimNext() {
        return archives.nextPending().map(archive -> {
            archive.attemptToken = UUID.randomUUID().toString();
            archive.leaseUntil = Instant.now().plus(PREPARATION_LEASE);
            final List<NewsArchiveSource> snapshots = archiveSources.findByArchiveIdOrderByPositionAsc(archive.id);
            return new Work(archive.id, archive.attemptToken, archive.leaseUntil,
                    snapshots.stream().map(snapshot -> snapshot.article).toList(), imageSources(snapshots));
        });
    }

    @Transactional
    public boolean complete(final long id, final String token, final List<NewsDtos.Article> articles) {
        final NewsArchive archive = archives.findLocked(id).orElse(null);
        if (!active(archive, token)) { return false; }
        final List<NewsArchiveSource> snapshots = archiveSources.findByArchiveIdOrderByPositionAsc(id);
        if (articles == null || articles.size() != snapshots.size()) { throw new IllegalArgumentException("Incomplete prepared news snapshot"); }
        requireImagesReady(id);
        for (int index = 0; index < snapshots.size(); index++) { snapshots.get(index).article = mapper.snapshot(articles.get(index)); }
        archive.status = "PUBLISHED"; archive.publishedAt = Instant.now(); archive.errorCode = null;
        archive.attemptToken = null; archive.leaseUntil = null; archive.revision++;
        return true;
    }

    @Transactional
    public boolean fail(final long id, final String token, final String errorCode) {
        final NewsArchive archive = archives.findLocked(id).orElse(null);
        if (!active(archive, token)) { return false; }
        failed(archive, safeError(errorCode));
        return true;
    }

    public void expireLeases() {
        final Instant now = Instant.now();
        for (final Long id : archives.expired(now)) {
            transaction.executeWithoutResult(tx -> {
                final NewsArchive archive = archives.findLocked(id).orElse(null);
                if (archive != null && "PREPARING".equals(archive.status) && archive.leaseUntil != null
                        && !archive.leaseUntil.isAfter(now)) { failed(archive, "NEWS_STORAGE_ERROR"); }
            });
        }
    }

    public static boolean active(final NewsArchive archive, final String token) {
        return archive != null && token != null && "PREPARING".equals(archive.status)
                && token.equals(archive.attemptToken) && archive.leaseUntil != null && archive.leaseUntil.isAfter(Instant.now());
    }

    private void requireImagesReady(final long id) {
        final int required = imageSources(archiveSources.findByArchiveIdOrderByPositionAsc(id)).size();
        if (archives.readyImageCount(id) != required) { throw conflict(); }
    }

    private static Map<String, String> imageSources(final List<NewsArchiveSource> snapshots) {
        final Map<String, String> images = new LinkedHashMap<>();
        snapshots.forEach(snapshot -> snapshot.imageSources.forEach((id, url) -> {
            final String previous = images.putIfAbsent(id, url);
            if (previous != null && !previous.equals(url)) { throw new IllegalStateException("Image identity collision"); }
        }));
        return Map.copyOf(images);
    }

    private NewsDtos.ReceiptResult result(final NewsReceipt receipt, final String hash) {
        if (!receipt.payloadHash.equals(hash)) { throw new ApiException(ApiErrorCode.NEWS_IDEMPOTENCY_CONFLICT); }
        final List<Long> existing = receipt.archiveIds.stream().filter(archives::existsById).toList();
        final List<Long> deleted = receipt.archiveIds.stream().filter(id -> !existing.contains(id)).toList();
        return new NewsDtos.ReceiptResult(existing, deleted);
    }

    private NewsDtos.Archive view(final NewsArchive archive) {
        return mapper.archive(archive, archiveSources.findByArchiveIdOrderByPositionAsc(archive.id));
    }
    private NewsArchive locked(final long id) { return archives.findLocked(id).orElseThrow(NewsArchiveService::missing); }
    private NewsArchive editable(final long id, final long revision, final String status) {
        final NewsArchive archive = locked(id);
        if (archive.revision != revision || !status.equals(archive.status)) { throw conflict(); }
        return archive;
    }
    private static void failed(final NewsArchive archive, final String code) {
        archive.status = "FAILED"; archive.errorCode = code; archive.attemptToken = null; archive.leaseUntil = null; archive.revision++;
    }
    private static String safeError(final String code) {
        return code != null && code.matches("NEWS_[A-Z_]{1,60}") ? code : "NEWS_STORAGE_ERROR";
    }
    public static void pagination(final int page, final int size) {
        if (page < 1 || page > 10000 || size < 1 || size > 50) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT); }
    }
    private static NewsDtos.CreateRequest normalized(final NewsDtos.CreateRequest request) {
        if (request == null || request.archives() == null || request.archives().isEmpty() || request.archives().size() > MAX_BATCH) {
            throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
        }
        final String key;
        try {
            key = UUID.fromString(request.idempotencyKey()).toString();
            if (!key.equals(request.idempotencyKey())) { throw new IllegalArgumentException(); }
        } catch (final IllegalArgumentException | NullPointerException e) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT); }
        return new NewsDtos.CreateRequest(key, request.archives().stream().map(draft -> {
            if (draft == null || draft.categoryIds() == null || draft.categoryIds().size() > 30
                    || draft.categoryIds().stream().anyMatch(id -> id == null || id < 1)
                    || new HashSet<>(draft.categoryIds()).size() != draft.categoryIds().size()
                    || draft.articles() == null || draft.articles().isEmpty() || draft.articles().size() > MAX_ARTICLES) {
                throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
            }
            final List<NewsDtos.Selection> selections = draft.articles().stream().map(selection -> {
                if (selection == null || selection.blockIds() == null || selection.blockIds().isEmpty()
                        || selection.blockIds().size() > 1000 || selection.blockIds().stream().anyMatch(Objects::isNull)
                        || new HashSet<>(selection.blockIds()).size() != selection.blockIds().size()) {
                    throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
                }
                return new NewsDtos.Selection(text(selection.sourceKey(), 200), text(selection.revision(), 128),
                        selection.blockIds().stream().map(block -> text(block, 100)).sorted().toList());
            }).toList();
            return new NewsDtos.Draft(text(draft.version(), 80), text(draft.title(), 300),
                    draft.categoryIds().stream().sorted().toList(), selections);
        }).toList());
    }
    private static String text(final String value, final int max) {
        if (!StringUtils.hasText(value) || value.length() > max || value.codePoints().anyMatch(Character::isISOControl)) {
            throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
        }
        return value.strip();
    }
    private static String hash(final String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (final NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static ApiException missing() { return new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); }
    private static ApiException conflict() { return new ApiException(ApiErrorCode.NEWS_STATE_CONFLICT); }
}
