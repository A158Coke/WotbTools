package com.wotb.web.creator;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.exception.CosServiceException;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.wotb.web.creator.entity.CreatorAvatar;
import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.creator.repository.CreatorAvatarRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.observation.aop.ObservedAspect;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.apache.http.client.methods.HttpRequestBase;
import org.springframework.aop.support.AopUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.sql.Connection;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.IntStream;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Real PostgreSQL lifecycle transactions with fake private COS; no uploader identity or HTTP upload API. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@Import(CreatorAvatarIntegrationTest.FakeCos.class)
class CreatorAvatarIntegrationTest {
    private static final String PREFIX = "creator-avatars/";
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
    }
    @TestConfiguration
    static class FakeCos {
        @Bean COSClient testCosClient() { return mock(COSClient.class); }
        @Bean @Primary CosImageStorage testCosStorage(final COSClient client) {
            return new CosImageStorage(client, "images-1251234567", "league-broadcasts/covers/", PREFIX);
        }
    }
    @Autowired CreatorAvatarService avatars;
    @Autowired CreatorService directory;
    @Autowired CreatorAvatarRepository reservations;
    @Autowired CreatorRepository creators;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @Autowired COSClient client;
    @Autowired MeterRegistry meters;
    @Autowired PrometheusMeterRegistry prometheus;
    @Autowired(required = false) ObservedAspect observedAspect;
    private final ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
    private final AtomicLong nextUid = new AtomicLong(1000);

    @BeforeEach void setup() throws Exception {
        jdbc.execute("truncate creator, creator_avatar, creator_category, creator_level restart identity cascade");
        jdbc.update("insert into creator_category(name) values ('A')");
        reset(client);
        objects.clear();
        doAnswer(call -> { objects.put(call.getArgument(1), ((InputStream) call.getArgument(2)).readAllBytes()); return null; })
                .when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
        when(client.getObject(anyString(), anyString())).thenAnswer(call -> {
            final byte[] bytes = objects.get((String) call.getArgument(1));
            if (bytes == null) { final CosServiceException error = new CosServiceException("missing"); error.setStatusCode(404); throw error; }
            return object(bytes);
        });
        doAnswer(call -> { objects.remove((String) call.getArgument(1)); return null; })
                .when(client).deleteObject(anyString(), anyString());
    }

    @Test void reservationIsDurableBeforePutAndNetworkDoesNotLockCatalogOrCreators() throws Exception {
        final long creator = creator();
        doAnswer(call -> {
            try (final Connection connection = jdbc.getDataSource().getConnection();
                 final var statement = connection.createStatement();
                 final var rows = statement.executeQuery("select status from creator_avatar")) {
                assertTrue(rows.next()); assertEquals("PENDING", rows.getString(1));
            }
            try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                    creators.lockCatalog(); creators.findLocked(creator).orElseThrow();
                })).get(3, TimeUnit.SECONDS);
            }
            objects.put(call.getArgument(1), ((InputStream) call.getArgument(2)).readAllBytes());
            return null;
        }).when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
        final String uploaded = avatars.upload(png(512, 256));
        final CreatorAvatar stored = reservations.findById(uploaded).orElseThrow();
        assertEquals("READY", stored.status);
        assertNotNull(stored.unreferencedAt);
        assertEquals(0, jdbc.queryForObject("select count(*) from information_schema.columns where table_name='creator_avatar' "
                + "and column_name='keycloak_subject'", Integer.class));
        final byte[] bytes = objects.get(PREFIX + uploaded);
        final BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertEquals(256, image.getWidth()); assertEquals(128, image.getHeight());
        assertEquals("image/jpeg", stored.contentType);
        assertEquals(bytes.length, stored.size);
        assertEquals(ImageValidation.sha256(bytes), stored.hash);
    }

    @Test void directorySaveOwnsImageReplacementRemovalAndFailedDuplicateCleanup() throws Exception {
        final RecommendationDtos.SaveRequest replace = new RecommendationDtos.SaveRequest("UP", "123", "Creator", null, List.of(1L), null, 3, "REPLACE", null);
        final RecommendationDtos.Detail created = directory.createRecommendation(replace, png(512, 256));
        final String original = avatarReference(created.id());
        assertNotNull(original);
        assertNull(reservations.findById(original).orElseThrow().unreferencedAt);
        final RecommendationDtos.Detail edited = directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Edited", null,
                List.of(1L), null, 4, "KEEP", created.version()), null);
        assertEquals(original, avatarReference(created.id()));
        assertEquals(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS,
                assertThrows(ApiException.class, () -> directory.createRecommendation(replace, png(32, 32))).errorCode());
        assertEquals(original, avatarReference(created.id()));
        final String orphan = reservations.findAll().stream().filter(row -> !row.id.equals(original)).findFirst().orElseThrow().id;
        assertNotNull(reservations.findById(orphan).orElseThrow().unreferencedAt);
        final RecommendationDtos.Detail replaced = directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Creator", null,
                List.of(1L), null, 3, "REPLACE", edited.version()), png(64, 32));
        final String replacement = avatarReference(created.id());
        assertFalse(original.equals(replacement));
        assertNotNull(reservations.findById(original).orElseThrow().unreferencedAt);
        assertNull(reservations.findById(replacement).orElseThrow().unreferencedAt);
        final RecommendationDtos.Detail cleared = directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Creator", null,
                List.of(1L), null, 3, "REMOVE", replaced.version()), null);
        assertNull(avatarReference(created.id()));
        assertNotNull(reservations.findById(replacement).orElseThrow().unreferencedAt);
        final RecommendationDtos.Detail finalImage = directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Creator", null,
                List.of(1L), null, 3, "REPLACE", cleared.version()), png(32, 32));
        final String removed = avatarReference(created.id());
        directory.deleteRecommendation("UP", created.id(), finalImage.version());
        assertNotNull(reservations.findById(removed).orElseThrow().unreferencedAt);
        reservations.findAll().forEach(row -> age(row.id));
        avatars.cleanup();
        assertEquals(0, reservations.count());
        assertTrue(objects.isEmpty());
    }

    @Test void staleDirectoryWritesKeepTheCurrentImageAndLeaveOnlyRecoverableReplacementObjects() throws Exception {
        final RecommendationDtos.Detail created = directory.createRecommendation(new RecommendationDtos.SaveRequest("UP", "123", "Original", null,
                List.of(1L), null, 3, "REPLACE", null), png(64, 32));
        final String original = avatarReference(created.id());
        final byte[] originalBytes = objects.get(PREFIX + original);
        final RecommendationDtos.Detail changed = directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Current", null,
                List.of(1L), null, 4, "KEEP", created.version()), null);
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, assertThrows(ApiException.class,
                () -> directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Stale removal", null,
                        List.of(1L), null, 1, "REMOVE", created.version()), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, assertThrows(ApiException.class,
                () -> directory.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "123", "Stale replacement", null,
                        List.of(1L), null, 1, "REPLACE", created.version()), png(32, 32))).errorCode());
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                assertThrows(ApiException.class, () -> directory.deleteRecommendation("UP", created.id(), created.version())).errorCode());
        assertEquals(changed, directory.recommendationDetail("UP", created.id()));
        assertEquals(original, avatarReference(created.id()));
        assertNull(reservations.findById(original).orElseThrow().unreferencedAt);
        assertArrayEquals(originalBytes, avatars.load(original).bytes());
        verify(client, never()).deleteObject(anyString(), anyString());
        final String orphan = reservations.findAll().stream().filter(row -> !row.id.equals(original)).findFirst().orElseThrow().id;
        assertNotNull(reservations.findById(orphan).orElseThrow().unreferencedAt);
        age(orphan); avatars.cleanup();
        assertFalse(reservations.existsById(orphan));
        assertTrue(reservations.existsById(original));
        assertArrayEquals(originalBytes, avatars.load(original).bytes());
    }

    @Test void invalidFilesAndMissingConfigurationNeverCreateLedgerRows() throws Exception {
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("image", new byte[] {1,2,3}))).errorCode());
        assertEquals(ApiErrorCode.FILE_TOO_LARGE, assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("image", new byte[ImageValidation.MAX_BYTES + 1]))).errorCode());
        final CosImageStorage unavailable = new CosImageStorage((COSClient) null, "images-1251234567", PREFIX);
        try {
            final CreatorAvatarService disabled = new CreatorAvatarService(reservations, creators, unavailable, transactions, PREFIX);
            assertFalse(disabled.configured());
            assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE, assertThrows(ApiException.class,
                    () -> disabled.upload(png(32, 32))).errorCode());
        } finally { unavailable.close(); }
        assertEquals(0, reservations.count());
    }

    @Test void failedPutAndFailedCleanupPreserveLedgerForRetry() throws Exception {
        doThrow(new CosClientException("test put failure")).when(client)
                .putObject(anyString(), anyString(), any(InputStream.class), any());
        assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE,
                assertThrows(ApiException.class, () -> avatars.upload(png(32, 32))).errorCode());
        final CreatorAvatar pending = reservations.findAll().getFirst();
        assertEquals("PENDING", pending.status);
        age(pending.id);
        doThrow(new CosClientException("test cleanup failure")).when(client).deleteObject(anyString(), anyString());
        avatars.cleanup();
        assertNotNull(reservations.findById(pending.id).orElseThrow().lastCleanupAttemptAt);
        doAnswer(call -> null).when(client).deleteObject(anyString(), anyString());
        avatars.cleanup();
        assertFalse(reservations.existsById(pending.id));
    }

    @Test void onlyReferencedReadyImagesArePublicAndIntegrityChecksRunOutsideTransactions() throws Exception {
        final String id = avatars.upload(png(32, 32));
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND,
                assertThrows(ApiException.class, () -> avatars.load(id)).errorCode());
        attach(creator(), id);
        final byte[] bytes = objects.get(PREFIX + id);
        doAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                executor.submit(() -> new TransactionTemplate(transactions).execute(tx -> reservations.findLocked(id)))
                        .get(3, TimeUnit.SECONDS);
            }
            return object(bytes);
        }).when(client).getObject(anyString(), anyString());
        assertArrayEquals(bytes, avatars.load(id).bytes());
        doAnswer(call -> object(new byte[] {1,2,3})).when(client).getObject(anyString(), anyString());
        assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE,
                assertThrows(ApiException.class, () -> avatars.load(id)).errorCode());
    }

    @Test void tinyOutputDimensionIsReadableWithoutApplyingSourceImageDecodeRulesAgain() throws Exception {
        final String id = avatars.upload(png(8192, 16));
        attach(creator(), id);
        final CreatorAvatarService.AvatarImage loaded = avatars.load(id);
        final BufferedImage image = ImageIO.read(new ByteArrayInputStream(loaded.bytes()));
        assertEquals(256, image.getWidth()); assertEquals(1, image.getHeight());
    }

    @Test void failedDirectoryTransactionLeavesOriginalReferenceAndRecoverableNewObject() throws Exception {
        final long creator = creator();
        final String original = avatars.upload(png(32, 32)); attach(creator, original);
        final String replacement = avatars.upload(png(32, 32));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                    creators.lockCatalog(); creators.findLocked(creator).orElseThrow();
                    avatars.attach(replacement);
                    jdbc.update("update creator set avatar_id=? where id=?", replacement, creator);
                    avatars.detach(original);
                    jdbc.update("update creator set stars=0 where id=?", creator);
                }));
        assertEquals(original, avatarReference(creator));
        assertNull(reservations.findById(original).orElseThrow().unreferencedAt);
        assertNotNull(reservations.findById(replacement).orElseThrow().unreferencedAt);
        age(replacement); avatars.cleanup();
        assertFalse(reservations.existsById(replacement));
        assertTrue(objects.containsKey(PREFIX + original));
    }

    @Test void committedReplacementSurvivesLostResponseAndRemovalGetsFreshGracePeriod() throws Exception {
        final long creator = creator();
        final String original = avatars.upload(png(32, 32)); attach(creator, original);
        final String replacement = avatars.upload(png(32, 32));
        assertThrows(IllegalStateException.class, () -> {
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                creators.lockCatalog(); creators.findLocked(creator).orElseThrow();
                avatars.attach(replacement);
                jdbc.update("update creator set avatar_id=? where id=?", replacement, creator);
                avatars.detach(original);
            });
            throw new IllegalStateException("test response lost after commit");
        });
        age(original); age(replacement); avatars.cleanup();
        assertFalse(reservations.existsById(original));
        assertEquals(replacement, avatarReference(creator));
        assertTrue(objects.containsKey(PREFIX + replacement));
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            creators.lockCatalog(); creators.findLocked(creator).orElseThrow();
            jdbc.update("update creator set avatar_id=null where id=?", creator);
            avatars.detach(replacement);
        });
        avatars.cleanup(); assertTrue(reservations.existsById(replacement));
        age(replacement); avatars.cleanup(); assertFalse(reservations.existsById(replacement));
    }

    @Test void cleanupAndAttachSerializeAndDeletedReservationsCannotBeResurrected() throws Exception {
        final long creator = creator();
        final String id = avatars.upload(png(32, 32)); age(id);
        final CountDownLatch deleting = new CountDownLatch(1);
        final CountDownLatch attaching = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        doAnswer(call -> { deleting.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return null; })
                .when(client).deleteObject(anyString(), anyString());
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var cleanup = executor.submit(avatars::cleanup);
            assertTrue(deleting.await(5, TimeUnit.SECONDS));
            final var attach = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                creators.lockCatalog(); attaching.countDown(); avatars.attach(id);
                jdbc.update("update creator set avatar_id=? where id=?", id, creator);
            }));
            assertTrue(attaching.await(5, TimeUnit.SECONDS)); release.countDown();
            cleanup.get(5, TimeUnit.SECONDS);
            assertTrue(assertThrows(ExecutionException.class, () -> attach.get(5, TimeUnit.SECONDS)).getCause() instanceof ApiException);
            assertFalse(reservations.existsById(id)); assertNull(avatarReference(creator));
        } finally { release.countDown(); }
    }

    @Test void permanentFailuresRotateWithoutDeletingForeignNamespaceObjects() throws Exception {
        final List<String> failed = IntStream.range(0, 100).mapToObj(index -> {
            final String id = UUID.randomUUID().toString();
            final String key = "retired-creator-avatars/" + id;
            jdbc.update("""
                    insert into creator_avatar(id,object_key,status,content_type,size,hash,created_at,unreferenced_at)
                    values (?,?,'READY','image/png',1,repeat('a',64),now()-interval '48 hours',now()-interval '48 hours')
                    """, id, key);
            objects.put(key, new byte[] {1}); return id;
        }).toList();
        final String later = avatars.upload(png(32, 32)); age(later);
        avatars.cleanup();
        assertEquals(101, reservations.count());
        assertEquals(100, jdbc.queryForObject("select count(*) from creator_avatar where last_cleanup_attempt_at is not null", Integer.class));
        verify(client, never()).deleteObject(anyString(), anyString());
        avatars.cleanup();
        assertFalse(reservations.existsById(later)); assertFalse(objects.containsKey(PREFIX + later));
        assertEquals(100, reservations.count());
        assertTrue(failed.stream().allMatch(id -> objects.containsKey("retired-creator-avatars/" + id)));
        verify(client, times(1)).deleteObject(anyString(), anyString());
    }

    @Test void failedAttemptStateWriteDoesNotAbortRemainingCleanupCandidates() throws Exception {
        final String blocked = avatars.upload(png(32, 32));
        final String foreign = "league-broadcasts/covers/" + blocked;
        final String later = avatars.upload(png(32, 32));
        jdbc.update("update creator_avatar set object_key=?,created_at=now()-interval '48 hours',"
                + "unreferenced_at=now()-interval '48 hours' where id=?", foreign, blocked);
        objects.put(foreign, objects.remove(PREFIX + blocked)); age(later);
        jdbc.execute("""
                create function creator_avatar_test_reject_attempt() returns trigger language plpgsql as $$
                begin raise exception 'test attempt write failure'; end; $$
                """);
        jdbc.execute("create trigger creator_avatar_test_reject_attempt before update of last_cleanup_attempt_at "
                + "on creator_avatar for each row execute function creator_avatar_test_reject_attempt()");
        try {
            avatars.cleanup();
            final CreatorAvatar preserved = reservations.findById(blocked).orElseThrow();
            assertEquals(foreign, preserved.objectKey); assertNull(preserved.lastCleanupAttemptAt);
            assertTrue(objects.containsKey(foreign)); assertFalse(reservations.existsById(later));
            verify(client, times(1)).deleteObject(anyString(), anyString());
        } finally {
            jdbc.execute("drop trigger creator_avatar_test_reject_attempt on creator_avatar");
            jdbc.execute("drop function creator_avatar_test_reject_attempt()");
        }
    }

    @Test void videoCoverUsesExistingCompressionAndSurvivesCleanupUntilFinalReferenceIsRemoved() throws Exception {
        final long category = directory.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        final var request = new RecommendationDtos.SaveRequest("VIDEO", "BV1AbCdEfGh2", "Video", null, List.of(category), null, 3, "REPLACE", null);
        final var video = directory.createRecommendation(request, png(1024, 576));
        final String cover = avatarReference(video.id());
        final BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(avatars.load(cover).bytes()));
        assertEquals(256, decoded.getWidth()); assertEquals(144, decoded.getHeight());
        age(cover); avatars.cleanup();
        assertTrue(reservations.existsById(cover)); assertTrue(objects.containsKey(PREFIX + cover));
        directory.deleteRecommendation("VIDEO", video.id(), video.version());
        age(cover); avatars.cleanup();
        assertFalse(reservations.existsById(cover)); assertFalse(objects.containsKey(PREFIX + cover));
    }

    @Test void observationInterceptsRealUploadExactlyOnceAndExposesHistogram() throws Exception {
        assertTrue(AopUtils.isAopProxy(avatars));
        assertNotNull(observedAspect);
        final double before = operationCount();
        final String id = avatars.upload(png(32, 32));
        assertNotNull(id);
        assertEquals(before + 1, operationCount(), 0.0);
        final Timer timer = operationTimer("none", "none");
        assertNotNull(timer);
        assertTrue(timer.count() >= 1);
        assertTrue(timer.totalTime(TimeUnit.NANOSECONDS) > 0);
        final String scrape = prometheus.scrape();
        assertTrue(scrape.contains("# TYPE wotb_creator_avatar_upload_seconds histogram"));
        assertTrue(scrape.contains("wotb_creator_avatar_upload_seconds_bucket{"));
        assertTrue(scrape.contains("le=\"+Inf\""));
        assertTrue(scrape.contains("wotb_creator_avatar_upload_seconds_count"));
        assertTrue(scrape.contains("wotb_creator_avatar_upload_seconds_sum"));
        assertTrue(scrape.contains("error_code=\"none\""));
    }

    @Test void observationKeepsBusinessAndUnexpectedErrorTaxonomy() throws Exception {
        final double beforeApi = operationCount();
        final ApiException api = assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("image", new byte[] {1, 2, 3})));
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, api.errorCode());
        assertEquals(beforeApi + 1, operationCount(), 0.0);
        assertNotNull(operationTimer("ApiException", "CREATOR_INVALID_REQUEST"));

        final IllegalStateException failure = new IllegalStateException("unexpected");
        doThrow(failure).when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
        final double beforeUnexpected = operationCount();
        final IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> avatars.upload(png(32, 32)));
        assertSame(failure, thrown);
        assertEquals(beforeUnexpected + 1, operationCount(), 0.0);
        assertNotNull(operationTimer("IllegalStateException", "unclassified"));
    }

    private double operationCount() {
        return meters.find(CreatorAvatarService.OBSERVATION_NAME).timers().stream()
                .mapToDouble(Timer::count).sum();
    }

    private Timer operationTimer(final String error, final String code) {
        return meters.find(CreatorAvatarService.OBSERVATION_NAME).timers().stream()
                .filter(timer -> error.equals(timer.getId().getTag("error")))
                .filter(timer -> code.equals(timer.getId().getTag("error.code"))
                        || code.equals(timer.getId().getTag("error_code")))
                .findFirst().orElse(null);
    }

    private long creator() {
        final long id = jdbc.queryForObject("insert into creator(bilibili_uid,name,stars,created_at) "
                + "values (?,'Creator',3,now()) returning id", Long.class, Long.toString(nextUid.incrementAndGet()));
        jdbc.update("insert into creator_category_link(creator_id,category_id) values (?,1)", id);
        return id;
    }
    private void attach(final long creator, final String avatar) {
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            creators.lockCatalog(); creators.findLocked(creator).orElseThrow(); avatars.attach(avatar);
            jdbc.update("update creator set avatar_id=? where id=?", avatar, creator);
        });
    }
    private String avatarReference(final long creator) { return jdbc.queryForObject("select avatar_id from creator where id=?", String.class, creator); }
    private void age(final String id) {
        jdbc.update("update creator_avatar set created_at=?,unreferenced_at=? where id=?",
                java.sql.Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)),
                java.sql.Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)), id);
    }
    private static COSObject object(final byte[] bytes) {
        final COSObject object = new COSObject();
        object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(bytes), mock(HttpRequestBase.class)));
        return object;
    }
    private static MockMultipartFile png(final int width, final int height) throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return new MockMultipartFile("image", "untrusted.exe", "application/octet-stream", bytes.toByteArray());
    }
}
