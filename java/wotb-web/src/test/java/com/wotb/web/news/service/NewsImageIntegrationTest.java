package com.wotb.web.news.service;

import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.repository.NewsArchiveRepository;
import com.wotb.web.news.repository.NewsImageRepository;
import com.wotb.web.util.BoundedCosStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Actual PostgreSQL row locks, receipt lifecycle and image references; cloud boundary is mocked. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"wotb.news.jobs.enabled=false", "wotb.news.source.enabled=false"})
class NewsImageIntegrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    @DynamicPropertySource static void properties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
    }
    @Autowired NewsArchiveService archives;
    @Autowired NewsArchiveRepository archiveRows;
    @Autowired NewsImageRepository images;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean NewsSourceService source;
    private BoundedCosStorage storage;
    private NewsImageService service;
    private byte[] png;
    private NewsDtos.Article article;
    private static final String SOURCE_ID = "a".repeat(64);
    private static final String URL = "https://media-wbp.wgcdn.co/news-test.png";

    @BeforeEach void setup() throws Exception {
        jdbc.execute("truncate news_archive,news_image,news_receipt restart identity cascade");
        reset(source);
        storage = mock(BoundedCosStorage.class);
        when(storage.configured()).thenReturn(true);
        when(storage.key(anyString())).thenAnswer(call -> "news/images/" + call.getArgument(0));
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(20, 20, BufferedImage.TYPE_INT_RGB), "png", output);
        png = output.toByteArray();
        when(storage.get(anyString())).thenReturn(png);
        when(source.downloadImage(URL)).thenReturn(png);
        article = new NewsDtos.Article("update", "Official title", "https://asia.wotblitz.com/en/news/updates/update/",
                "en", "2026-10-17T12:00:00", SOURCE_ID, "revision", List.of(
                        new NewsDtos.Block("b0", "<p>Approved text</p>"),
                        new NewsDtos.Block("b1", "<img src=\"/api/news/source-images/" + SOURCE_ID + "\">")), null);
        when(source.selected(any())).thenReturn(article);
        when(source.imageSources(any())).thenReturn(Map.of(SOURCE_ID, URL));
        service = new NewsImageService(images, archiveRows, archives, source, transactions, storage, false);
    }
    @AfterEach void close() { service.close(); }

    @Test void allImagesMustBeReadyBeforePublishingAndWithdrawalControlsImageAccess() {
        final long id = create();
        assertThrows(ApiException.class, () -> archives.get(id, false));
        assertThrows(ApiException.class, () -> archives.delete(id, 0, true));
        final var work = archives.claimNext().orElseThrow();
        service.prepare(work);
        final var published = archives.get(id, false);
        assertEquals("PUBLISHED", published.status());
        final String imageId = published.articles().getFirst().coverImageId();
        assertTrue(published.articles().getFirst().blocks().get(1).html().contains("/api/news/images/" + imageId));
        assertArrayEquals(png, service.image(imageId, false).bytes());
        assertEquals("Approved text", org.jsoup.Jsoup.parse(published.articles().getFirst().blocks().getFirst().html()).text());
        final var withdrawn = archives.withdraw(id, published.revision());
        assertThrows(ApiException.class, () -> service.image(imageId, false));
        assertArrayEquals(png, service.image(imageId, true).bytes());
        assertArrayEquals(png, service.frozenSourceImage(id, SOURCE_ID).bytes());
        verify(source, never()).imageSource(anyString());
        when(storage.get(anyString())).thenReturn(new byte[] {1, 2, 3});
        assertThrows(ApiException.class, () -> service.restore(id, withdrawn.revision()));
        assertEquals("WITHDRAWN", archives.get(id, true).status());
        when(storage.get(anyString())).thenReturn(png);
        assertEquals("PUBLISHED", service.restore(id, withdrawn.revision()).status());
        verify(source, times(1)).selected(any());
    }

    @Test void failedPutRetainsReservationAndRetryUsesFrozenSource() {
        final long id = create();
        doThrow(new ApiException(ApiErrorCode.NEWS_STORAGE_ERROR)).when(storage).put(anyString(), any());
        service.prepare(archives.claimNext().orElseThrow());
        assertEquals("FAILED", archives.get(id, true).status());
        assertEquals(1, images.count());
        assertArrayEquals(png, service.frozenSourceImage(id, SOURCE_ID).bytes());
        doNothing().when(storage).put(anyString(), any());
        archives.retry(id, archives.get(id, true).revision());
        service.prepare(archives.claimNext().orElseThrow());
        assertEquals("PUBLISHED", archives.get(id, false).status());
        assertEquals(1, images.count());
        verify(source, times(1)).selected(any());
    }

    @Test void zeroImageArchiveDoesNotRequireConfiguredStorage() {
        final var noImages = new NewsDtos.Article("update", "Zero images", article.sourceUrl(), "en",
                article.publishedAtRaw(), null, "revision", List.of(article.blocks().getFirst()), null);
        when(source.selected(any())).thenReturn(noImages);
        when(source.imageSources(any())).thenReturn(Map.of());
        when(storage.configured()).thenReturn(false);
        final long id = create();
        service.prepare(archives.claimNext().orElseThrow());
        assertEquals("PUBLISHED", archives.get(id, false).status());
        verify(storage, never()).put(anyString(), any());
    }

    @Test void lateDownloaderCannotPutAfterExpiryDeletionAndGarbageCollection() throws Exception {
        final long id = create();
        final var work = archives.claimNext().orElseThrow();
        final CountDownLatch downloading = new CountDownLatch(1);
        final CountDownLatch resume = new CountDownLatch(1);
        when(source.downloadImage(URL)).thenAnswer(call -> {
            downloading.countDown();
            assertTrue(resume.await(10, TimeUnit.SECONDS));
            return png;
        });
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var preparation = executor.submit(() -> service.prepare(work));
            try {
                assertTrue(downloading.await(10, TimeUnit.SECONDS));
                jdbc.update("update news_archive set lease_until=now()-interval '1 second' where id=?", id);
                archives.expireLeases();
                archives.delete(id, archives.get(id, true).revision(), true);
                jdbc.update("update news_image set unreferenced_at=now()-interval '25 hours'");
                service.cleanup();
                assertEquals(0, images.count());
            } finally { resume.countDown(); }
            preparation.get(10, TimeUnit.SECONDS);
        }
        verify(storage, never()).put(anyString(), any());
        assertFalse(archiveRows.existsById(id));
    }

    @Test void lastReferenceGetsGraceAndFailedDeletesRemainRecoverable() {
        final long id = create();
        service.prepare(archives.claimNext().orElseThrow());
        final var published = archives.get(id, false);
        final String imageId = published.articles().getFirst().coverImageId();
        jdbc.update("update news_image set created_at=now()-interval '48 hours'");
        service.cleanup();
        verify(storage, never()).delete(anyString());
        final var withdrawn = archives.withdraw(id, published.revision());
        archives.delete(id, withdrawn.revision(), true);
        service.cleanup();
        assertEquals(1, images.count());
        jdbc.update("update news_image set unreferenced_at=now()-interval '25 hours'");
        doThrow(new ApiException(ApiErrorCode.NEWS_STORAGE_ERROR)).when(storage).delete(anyString());
        service.cleanup();
        assertEquals("DELETING", images.findById(imageId).orElseThrow().status);
        doNothing().when(storage).delete(anyString());
        service.cleanup();
        assertEquals(0, images.count());
    }

    @Test void newsCanPreserveSmallGifWhileExistingEvidencePolicyStillRejectsIt() throws Exception {
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "gif", output);
        final byte[] gif = output.toByteArray();
        assertEquals("image/gif", ImageValidation.validateNews(gif).contentType());
        assertThrows(IllegalArgumentException.class, () -> ImageValidation.validate(gif));
        final byte[] oversizedCanvas = gif.clone();
        for (int index = 6; index < 10; index++) { oversizedCanvas[index] = (byte) 0xff; }
        assertThrows(IllegalArgumentException.class, () -> ImageValidation.validateNews(oversizedCanvas));
    }

    @Test void anotherArchiveReferenceProtectsSharedImageAndStartsGraceOnlyAfterLastDetach() {
        final long first = create();
        service.prepare(archives.claimNext().orElseThrow());
        final var published = archives.get(first, false);
        final String imageId = published.articles().getFirst().coverImageId();
        final long second = create();
        jdbc.update("insert into news_archive_image(archive_id,image_id) values (?,?)", second, imageId);
        jdbc.update("update news_image set created_at=now()-interval '48 hours'");
        final var withdrawn = archives.withdraw(first, published.revision());
        archives.delete(first, withdrawn.revision(), true);
        service.cleanup();
        assertEquals(1, images.count());
        verify(storage, never()).delete(anyString());
        final var secondWork = archives.claimNext().orElseThrow();
        archives.fail(second, secondWork.attemptToken(), "NEWS_STORAGE_ERROR");
        archives.delete(second, archives.get(second, true).revision(), true);
        service.cleanup();
        assertEquals(1, images.count());
        jdbc.update("update news_image set unreferenced_at=now()-interval '25 hours'");
        service.cleanup();
        assertEquals(0, images.count());
    }

    private long create() {
        return archives.create("reviewer", new NewsDtos.CreateRequest(UUID.randomUUID().toString(), List.of(
                new NewsDtos.Draft("11.21", "Reviewed update", List.of(), List.of(
                        new NewsDtos.Selection("update", "revision", List.of("b0", "b1"))))))).archiveIds().getFirst();
    }
}
