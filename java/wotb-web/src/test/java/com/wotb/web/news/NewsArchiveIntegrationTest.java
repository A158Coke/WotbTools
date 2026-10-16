package com.wotb.web.news;

import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.service.NewsArchiveService;
import com.wotb.web.news.service.NewsImageService;
import com.wotb.web.news.service.NewsSourceService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

/** Real PostgreSQL migrations, row locks, JSON snapshots, idempotency and FK protection. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class NewsArchiveIntegrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    @DynamicPropertySource static void properties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("wotb.tournament.recognition-signing-key", () -> "integration-only-32-byte-signing-secret");
    }
    @Autowired NewsArchiveService service;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean NewsSourceService sources;
    @MockitoBean NewsImageService images;
    private long general;
    private long special;

    @BeforeEach void setup() {
        jdbc.update("delete from news_archive"); jdbc.update("delete from news_image");
        jdbc.update("delete from news_receipt"); jdbc.update("delete from news_category");
        general = service.createCategory(new NewsDtos.CategoryCreate("Update", "GENERAL")).id();
        special = service.createCategory(new NewsDtos.CategoryCreate("Tanks", "SPECIALIZED")).id();
        when(sources.selected(any())).thenAnswer(call -> article(((NewsDtos.Selection) call.getArgument(0)).sourceKey()));
        when(sources.imageSources(any())).thenReturn(Map.of());
    }

    @Test void freezesSnapshotsAndPreservesIdempotencyAfterWithdrawalAndDeletion() {
        final NewsDtos.CreateRequest request = request(List.of(general, special));
        final long id = service.create("reviewer", request).archiveIds().getFirst();
        assertEquals(List.of(id), service.create("reviewer", request).archiveIds());
        assertCode(ApiErrorCode.RESOURCE_NOT_FOUND, () -> service.get(id, false));
        assertCode(ApiErrorCode.NEWS_CATEGORY_IN_USE, () -> service.deleteCategory(special));
        assertCode(ApiErrorCode.NEWS_STATE_CONFLICT, () -> service.delete(id, 0, true));
        final NewsArchiveService.Work work = service.claimNext().orElseThrow();
        assertEquals(id, work.id()); assertEquals("<p>Selected original</p>", work.articles().getFirst().blocks().getFirst().html());
        assertTrue(service.complete(id, work.attemptToken(), work.articles()));
        assertEquals("PUBLISHED", service.get(id, false).status());
        assertEquals("2026-10-13T14:15:00", service.get(id, false).articles().getFirst().publishedAtRaw());
        assertCode(ApiErrorCode.NEWS_STATE_CONFLICT, () -> service.delete(id, 1, true));
        assertEquals("WITHDRAWN", service.withdraw(id, 1).status());
        assertCode(ApiErrorCode.RESOURCE_NOT_FOUND, () -> service.get(id, false));
        assertEquals(0, service.list(1, 20, "WG", null, false).totalItems());
        assertCode(ApiErrorCode.NEWS_CATEGORY_IN_USE, () -> service.deleteCategory(special));
        assertEquals("PUBLISHED", service.restoreVerified(id, 2).status());
        service.withdraw(id, 3); service.delete(id, 4, true);
        final NewsDtos.ReceiptResult tombstone = service.create("reviewer", request);
        assertTrue(tombstone.archiveIds().isEmpty()); assertEquals(List.of(id), tombstone.deletedIds());
        assertEquals(0L, jdbc.queryForObject("select count(*) from news_archive_source", Long.class));
        service.deleteCategory(special);
        assertEquals(1, service.categories().size());
    }

    @Test void separateArchivesSameVersionAndSourceAreAllowedButInvalidBatchIsAtomic() {
        final NewsDtos.Draft draft = request(List.of(general)).archives().getFirst();
        final var batch = new NewsDtos.CreateRequest(UUID.randomUUID().toString(), List.of(draft, draft));
        final List<Long> ids = service.create("reviewer", batch).archiveIds();
        assertEquals(2, ids.size()); assertNotEquals(ids.get(0), ids.get(1));
        final long otherSpecial = service.createCategory(new NewsDtos.CategoryCreate("Mechanics", "SPECIALIZED")).id();
        final NewsDtos.Draft invalid = new NewsDtos.Draft("11.21", "Invalid", List.of(special, otherSpecial), draft.articles());
        final long receipts = jdbc.queryForObject("select count(*) from news_receipt", Long.class);
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.create("reviewer",
                new NewsDtos.CreateRequest(UUID.randomUUID().toString(), List.of(draft, invalid))));
        assertEquals(2L, jdbc.queryForObject("select count(*) from news_archive", Long.class));
        assertEquals(receipts, jdbc.queryForObject("select count(*) from news_receipt", Long.class));
    }

    @Test void sameKeyConcurrentSubmissionsProduceExactlyOneArchiveAndCannotChangePayload() throws Exception {
        final NewsDtos.CreateRequest request = request(List.of(general));
        final CountDownLatch start = new CountDownLatch(1);
        try (final var pool = Executors.newFixedThreadPool(2)) {
            final var one = pool.submit(() -> { start.await(); return service.create("reviewer", request); });
            final var two = pool.submit(() -> { start.await(); return service.create("reviewer", request); });
            start.countDown();
            assertEquals(one.get(20, TimeUnit.SECONDS), two.get(20, TimeUnit.SECONDS));
        }
        assertEquals(1L, jdbc.queryForObject("select count(*) from news_archive", Long.class));
        final var changed = new NewsDtos.CreateRequest(request.idempotencyKey(),
                List.of(new NewsDtos.Draft("12.0", "Other", List.of(general), request.archives().getFirst().articles())));
        assertCode(ApiErrorCode.NEWS_IDEMPOTENCY_CONFLICT, () -> service.create("reviewer", changed));
        doThrow(new ApiException(ApiErrorCode.NEWS_REVISION_CONFLICT)).when(sources).selected(any());
        assertEquals(1, service.create("reviewer", request).archiveIds().size());
    }

    @Test void expiryInvalidatesLateWorkerAndRetryKeepsFrozenContentAndCategories() {
        final long id = service.create("reviewer", request(List.of(general))).archiveIds().getFirst();
        final NewsArchiveService.Work old = service.claimNext().orElseThrow();
        jdbc.update("update news_archive set lease_until = ? where id = ?", java.sql.Timestamp.from(Instant.now().minusSeconds(1)), id);
        service.expireLeases();
        assertEquals("FAILED", service.get(id, true).status());
        assertFalse(service.complete(id, old.attemptToken(), old.articles()));
        assertFalse(service.fail(id, old.attemptToken(), "NEWS_STORAGE_ERROR"));
        doThrow(new ApiException(ApiErrorCode.NEWS_REVISION_CONFLICT)).when(sources).selected(any());
        service.retry(id, 1);
        final NewsArchiveService.Work fresh = service.claimNext().orElseThrow();
        assertNotEquals(old.attemptToken(), fresh.attemptToken());
        assertFalse(service.complete(id, old.attemptToken(), old.articles()));
        assertTrue(service.complete(id, fresh.attemptToken(), fresh.articles()));
        assertEquals(List.of(general), service.get(id, true).categories().stream().map(NewsDtos.Category::id).toList());
        assertEquals(old.articles(), fresh.articles());
    }

    @Test void categoryDeleteAndArchiveSaveNeverProduceBrokenReferences() throws Exception {
        final NewsDtos.CreateRequest request = request(List.of(general));
        final CountDownLatch start = new CountDownLatch(1);
        try (final var pool = Executors.newFixedThreadPool(2)) {
            final var saving = pool.submit(() -> { start.await(); try { service.create("reviewer", request); return true; }
                catch (final ApiException e) { assertEquals(ApiErrorCode.INVALID_ARGUMENT, e.errorCode()); return false; } });
            final var deleting = pool.submit(() -> { start.await(); try { service.deleteCategory(general); return true; }
                catch (final ApiException e) { assertEquals(ApiErrorCode.NEWS_CATEGORY_IN_USE, e.errorCode()); return false; } });
            start.countDown();
            assertNotEquals(saving.get(20, TimeUnit.SECONDS), deleting.get(20, TimeUnit.SECONDS));
        }
        assertEquals(0L, jdbc.queryForObject("select count(*) from news_archive_category r left join news_category c on c.id=r.category_id where c.id is null", Long.class));
    }

    @Test void missingNecessaryImagesPreventPublicationAndDeletionStartsGracePeriod() {
        final String imageId = UUID.randomUUID().toString();
        when(sources.imageSources(any())).thenReturn(Map.of("source-image", "https://example.invalid/image.png"));
        final long id = service.create("reviewer", request(List.of(general))).archiveIds().getFirst();
        final NewsArchiveService.Work work = service.claimNext().orElseThrow();
        assertCode(ApiErrorCode.NEWS_STATE_CONFLICT, () -> service.complete(id, work.attemptToken(), work.articles()));
        jdbc.update("insert into news_image(id,archive_id,source_image_id,source_url,object_key,status,created_at) values (?,?,?,?,?,'READY',now()-interval '3 days')",
                imageId, id, "source-image", "https://example.invalid/image.png", "news/images/" + imageId);
        jdbc.update("insert into news_archive_image values (?,?)", id, imageId);
        assertTrue(service.complete(id, work.attemptToken(), work.articles()));
        service.withdraw(id, 1); service.delete(id, 2, true);
        assertEquals(0L, jdbc.queryForObject("select count(*) from news_archive_image", Long.class));
        assertTrue(jdbc.queryForObject("select unreferenced_at > now()-interval '1 minute' from news_image where id=?", Boolean.class, imageId));
    }

    @Test void oversizedFrozenSnapshotIsRejectedBeforeAnyReceiptOrArchiveExists() {
        final NewsDtos.Article large = new NewsDtos.Article("old", "Title", "https://example.invalid/article", "en",
                "2026-10-13T14:15:00", null, "revision", List.of(new NewsDtos.Block("0", "x".repeat(4 * 1024 * 1024 + 1))), null);
        doReturn(large).when(sources).selected(any());
        assertCode(ApiErrorCode.FILE_TOO_LARGE, () -> service.create("reviewer", request(List.of(general))));
        assertEquals(0L, jdbc.queryForObject("select count(*) from news_archive", Long.class));
        assertEquals(0L, jdbc.queryForObject("select count(*) from news_receipt", Long.class));
    }

    private static NewsDtos.Article article(final String key) {
        return new NewsDtos.Article(key, "Original title", "https://asia.wotblitz.com/en/news/updates/" + key + "/",
                "en", "2026-10-13T14:15:00", null, "revision", List.of(new NewsDtos.Block("block", "<p>Selected original</p>")), null);
    }
    private static NewsDtos.CreateRequest request(final List<Long> categories) {
        return new NewsDtos.CreateRequest(UUID.randomUUID().toString(), List.of(new NewsDtos.Draft("11.21", "Archive",
                categories, List.of(new NewsDtos.Selection("update", "revision", List.of("block"))))));
    }
    private static void assertCode(final ApiErrorCode code, final Runnable action) {
        assertEquals(code, assertThrows(ApiException.class, action::run).errorCode());
    }
}
