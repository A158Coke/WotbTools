package com.wotb.web.news.service;

import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.entity.NewsArchive;
import com.wotb.web.news.entity.NewsImage;
import com.wotb.web.news.repository.NewsArchiveRepository;
import com.wotb.web.news.repository.NewsImageRepository;
import com.wotb.web.util.BoundedCosStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import jakarta.annotation.PreDestroy;
import org.jsoup.Jsoup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

/** Frozen-image preparation and durable orphan recovery; never re-fetches article text. */
@Service
public class NewsImageService {
    private static final Logger LOG = LoggerFactory.getLogger(NewsImageService.class);
    private static final String SOURCE_PATH = "/api/news/source-images/";
    private static final String ARCHIVE_PATH = "/api/news/images/";
    private final NewsImageRepository images;
    private final NewsArchiveRepository archiveRows;
    private final NewsArchiveService archives;
    private final NewsSourceService sources;
    private final BoundedCosStorage storage;
    private final TransactionTemplate transaction;
    private final boolean jobsEnabled;
    private final ExecutorService workers = Executors.newFixedThreadPool(3,
            Thread.ofPlatform().daemon().name("news-images-", 0).factory());
    private final Semaphore capacity = new Semaphore(2);
    private final AtomicBoolean cleaning = new AtomicBoolean();

    public record Blob(byte[] bytes, String contentType, String hash) { }

    @Autowired
    public NewsImageService(final NewsImageRepository images, final NewsArchiveRepository archiveRows,
                            final NewsArchiveService archives, final NewsSourceService sources,
                            final PlatformTransactionManager transactions,
                            @Value("${wotb.news.cos.bucket:}") final String bucket,
                            @Value("${wotb.news.cos.region:}") final String region,
                            @Value("${wotb.news.cos.secret-id:}") final String secretId,
                            @Value("${wotb.news.cos.secret-key:}") final String secretKey,
                            @Value("${wotb.news.cos.prefix:news/images/}") final String prefix,
                            @Value("${wotb.news.jobs.enabled:true}") final boolean jobsEnabled) {
        this(images, archiveRows, archives, sources, transactions,
                new BoundedCosStorage(bucket, region, secretId, secretKey, prefix,
                        ApiErrorCode.NEWS_STORAGE_UNAVAILABLE, ApiErrorCode.NEWS_STORAGE_ERROR,
                        ApiErrorCode.NEWS_IMAGE_INVALID), jobsEnabled);
    }

    NewsImageService(final NewsImageRepository images, final NewsArchiveRepository archiveRows,
                     final NewsArchiveService archives, final NewsSourceService sources,
                     final PlatformTransactionManager transactions, final BoundedCosStorage storage,
                     final boolean jobsEnabled) {
        this.images = images;
        this.archiveRows = archiveRows;
        this.archives = archives;
        this.sources = sources;
        this.storage = storage;
        this.jobsEnabled = jobsEnabled;
        transaction = new TransactionTemplate(transactions);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Scheduled(fixedDelayString = "${wotb.news.worker-delay-ms:5000}")
    public void dispatch() {
        if (!jobsEnabled) { return; }
        archives.expireLeases();
        while (capacity.tryAcquire()) {
            try {
                final var work = archives.claimNext();
                if (work.isEmpty()) { capacity.release(); return; }
                workers.execute(() -> {
                    try { prepare(work.get()); }
                    finally { capacity.release(); }
                });
            } catch (final RuntimeException e) {
                capacity.release();
                throw e;
            }
        }
    }

    /** Package-visible for real transaction/worker integration tests. */
    void prepare(final NewsArchiveService.Work work) {
        try {
            final Map<String, String> replacements = new LinkedHashMap<>();
            for (final var entry : work.imageSources().entrySet()) {
                if (!Instant.now().isBefore(work.leaseUntil())) { throw conflict(); }
                final String id = reserve(work, entry.getKey(), entry.getValue());
                final NewsImage image = images.findById(id).orElseThrow(NewsImageService::conflict);
                if (!"READY".equals(image.status)) {
                    final ImageValidation.Image downloaded = validate(sources.downloadImage(image.sourceUrl));
                    // Lock the reservation during the bounded PUT. A late worker cannot recreate
                    // an object after GC has deleted its durable reservation.
                    transaction.executeWithoutResult(tx -> {
                        final NewsImage locked = images.findLocked(id).orElseThrow(NewsImageService::conflict);
                        requireAttempt(archiveRows.findById(work.id()).orElse(null), work);
                        if ("DELETING".equals(locked.status)) { throw conflict(); }
                        if (!"READY".equals(locked.status)) {
                            storage.put(locked.objectKey, downloaded);
                            locked.contentType = downloaded.contentType();
                            locked.imageHash = downloaded.hash();
                            locked.sizeBytes = (long) downloaded.bytes().length;
                            locked.status = "READY";
                        }
                    });
                }
                replacements.put(entry.getKey(), id);
            }
            archives.complete(work.id(), work.attemptToken(), rewrite(work.articles(), replacements));
        } catch (final ApiException e) {
            archives.fail(work.id(), work.attemptToken(), e.errorCode().name());
        } catch (final RuntimeException e) {
            archives.fail(work.id(), work.attemptToken(), ApiErrorCode.NEWS_STORAGE_ERROR.name());
            LOG.warn("News image preparation failed: archiveId={}, type={}", work.id(), e.getClass().getSimpleName());
        }
    }

    private String reserve(final NewsArchiveService.Work work, final String sourceId, final String url) {
        return transaction.execute(tx -> {
            final NewsArchive archive = archiveRows.findLocked(work.id()).orElseThrow(NewsImageService::conflict);
            requireAttempt(archive, work);
            final NewsImage image = images.findByArchiveIdAndSourceImageId(work.id(), sourceId).orElseGet(() -> {
                final NewsImage created = new NewsImage();
                created.id = UUID.randomUUID().toString();
                created.archiveId = work.id();
                created.sourceImageId = sourceId;
                created.sourceUrl = url;
                created.objectKey = storage.key(created.id);
                created.status = "PENDING";
                created.createdAt = Instant.now();
                return images.saveAndFlush(created);
            });
            final NewsImage locked = images.findLocked(image.id).orElseThrow(NewsImageService::conflict);
            if ("DELETING".equals(locked.status) || !url.equals(locked.sourceUrl)) { throw conflict(); }
            images.attach(work.id(), image.id);
            locked.unreferencedAt = null;
            return image.id;
        });
    }

    private static void requireAttempt(final NewsArchive archive, final NewsArchiveService.Work work) {
        if (!NewsArchiveService.active(archive, work.attemptToken())) { throw conflict(); }
    }

    static List<NewsDtos.Article> rewrite(final List<NewsDtos.Article> articles, final Map<String, String> replacements) {
        final List<NewsDtos.Article> result = new ArrayList<>();
        for (final NewsDtos.Article article : articles) {
            final List<NewsDtos.Block> blocks = article.blocks().stream().map(block -> {
                final var document = Jsoup.parseBodyFragment(block.html());
                document.outputSettings().prettyPrint(false);
                for (final var img : document.select("img")) {
                    final String src = img.attr("src");
                    if (!src.startsWith(SOURCE_PATH)) { throw new ApiException(ApiErrorCode.NEWS_IMAGE_INVALID); }
                    final String replacement = replacements.get(src.substring(SOURCE_PATH.length()));
                    if (replacement == null) { throw new ApiException(ApiErrorCode.NEWS_IMAGE_INVALID); }
                    img.attr("src", ARCHIVE_PATH + replacement);
                }
                return new NewsDtos.Block(block.id(), document.body().html());
            }).toList();
            final String cover = article.coverImageId() == null ? null : replacements.get(article.coverImageId());
            if (article.coverImageId() != null && cover == null) { throw new ApiException(ApiErrorCode.NEWS_IMAGE_INVALID); }
            result.add(new NewsDtos.Article(article.sourceKey(), article.title(), article.sourceUrl(), article.language(),
                    article.publishedAtRaw(), cover, article.revision(), blocks, null));
        }
        return List.copyOf(result);
    }

    public Blob sourceImage(final String id) {
        final ImageValidation.Image image = validate(sources.sourceImage(id));
        return new Blob(image.bytes(), image.contentType(), image.hash());
    }

    public Blob frozenSourceImage(final long archiveId, final String sourceId) {
        final String url = archives.frozenImageSources(archiveId).get(sourceId);
        if (url == null) { throw notFound(); }
        final NewsImage ready = images.findByArchiveIdAndSourceImageId(archiveId, sourceId).orElse(null);
        if (ready != null && "READY".equals(ready.status)) { return image(ready.id, true); }
        final ImageValidation.Image decoded = validate(sources.downloadImage(url));
        return new Blob(decoded.bytes(), decoded.contentType(), decoded.hash());
    }

    public Blob image(final String id, final boolean admin) {
        final NewsImage stored = transaction.execute(tx -> {
            final NewsImage image = images.findById(id).orElseThrow(NewsImageService::notFound);
            if (!"READY".equals(image.status) || !(admin ? images.referenced(id) : images.publiclyReferenced(id))) {
                throw notFound();
            }
            return image;
        });
        final ImageValidation.Image decoded = validate(storage.get(stored.objectKey));
        if (!decoded.hash().equals(stored.imageHash) || !decoded.contentType().equals(stored.contentType)
                || stored.sizeBytes == null || decoded.bytes().length != stored.sizeBytes) {
            throw new ApiException(ApiErrorCode.NEWS_STORAGE_ERROR);
        }
        return new Blob(decoded.bytes(), decoded.contentType(), decoded.hash());
    }

    public NewsDtos.Archive restore(final long id, final long expectedRevision) {
        final NewsDtos.Archive archive = archives.get(id, true);
        if (!"WITHDRAWN".equals(archive.status()) || archive.revision() != expectedRevision) { throw conflict(); }
        for (final NewsDtos.Article article : archive.articles()) {
            if (article.coverImageId() != null) { image(article.coverImageId(), true); }
            for (final NewsDtos.Block block : article.blocks()) {
                for (final var img : Jsoup.parseBodyFragment(block.html()).select("img")) {
                    if (!img.attr("src").startsWith(ARCHIVE_PATH)) { throw conflict(); }
                    image(img.attr("src").substring(ARCHIVE_PATH.length()), true);
                }
            }
        }
        return archives.restoreVerified(id, expectedRevision);
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT1H")
    public void dispatchCleanup() {
        if (jobsEnabled && storage.configured() && cleaning.compareAndSet(false, true)) {
            workers.execute(() -> {
                try { cleanup(); }
                finally { cleaning.set(false); }
            });
        }
    }

    void cleanup() {
        final Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (final String id : images.expired(cutoff)) {
            try {
                final String key = transaction.execute(tx -> {
                    final NewsImage row = images.findLocked(id).orElse(null);
                    if (row == null || images.referenced(id)) { return null; }
                    final Instant unreferenced = row.unreferencedAt == null ? row.createdAt : row.unreferencedAt;
                    if (!unreferenced.isBefore(cutoff)) { return null; }
                    row.status = "DELETING";
                    return row.objectKey;
                });
                if (key == null) { continue; }
                storage.delete(key);
                transaction.executeWithoutResult(tx -> {
                    final NewsImage row = images.findLocked(id).orElse(null);
                    if (row != null && "DELETING".equals(row.status) && !images.referenced(id)) { images.delete(row); }
                });
            } catch (final RuntimeException e) {
                LOG.warn("News image cleanup failed: imageId={}, type={}", id, e.getClass().getSimpleName());
            }
        }
    }

    private static ImageValidation.Image validate(final byte[] bytes) {
        try { return ImageValidation.validateNews(bytes); }
        catch (final IOException | IllegalArgumentException e) { throw new ApiException(ApiErrorCode.NEWS_IMAGE_INVALID); }
    }

    private static ApiException conflict() { return new ApiException(ApiErrorCode.NEWS_STATE_CONFLICT); }
    private static ApiException notFound() { return new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); }

    @PreDestroy public void close() { workers.shutdownNow(); storage.close(); }
}
