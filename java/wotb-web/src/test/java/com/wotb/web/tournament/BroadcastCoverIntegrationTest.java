package com.wotb.web.tournament;

import com.wotb.web.tournament.entity.BroadcastCover;
import com.wotb.web.tournament.repository.BroadcastCoverRepository;
import com.wotb.web.tournament.repository.BroadcastSeasonRepository;
import com.wotb.web.tournament.service.BroadcastCosStorage;
import com.wotb.web.tournament.service.BroadcastCoverService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.sql.Connection;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Actual PostgreSQL transactions/locks/FKs; the concrete COS boundary is mocked, never cloud-backed. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class BroadcastCoverIntegrationTest {
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
    @Autowired BroadcastCoverService service;
    @Autowired BroadcastCoverRepository covers;
    @Autowired BroadcastSeasonRepository seasons;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean BroadcastCosStorage storage;
    private long seasonId;
    private long nodeId;

    @BeforeEach void setup() {
        jdbc.execute("truncate tournament_broadcast_season, tournament_broadcast_category, tournament_broadcast_node, "
                + "tournament_broadcast_replay, tournament_broadcast_cover restart identity cascade");
        reset(storage);
        when(storage.configured()).thenReturn(true);
        when(storage.key(anyString())).thenAnswer(call -> "league-broadcasts/covers/" + call.getArgument(0));
        seasonId = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name,created_at) "
                + "values ('CN',2026,'Cover test',now()) returning id", Long.class);
        final long categoryId = jdbc.queryForObject("insert into tournament_broadcast_category(season_id,type) "
                + "values (?,'POINTS') returning id", Long.class, seasonId);
        nodeId = jdbc.queryForObject("insert into tournament_broadcast_node(category_id,root_key,round_number) "
                + "values (?,1,1) returning id", Long.class, categoryId);
    }

    @Test void reservationIsCommittedBeforePutAndNetworkNeverHoldsASeasonLock() throws Exception {
        doAnswer(call -> {
            // A different physical connection can already see the durable PENDING row.
            try (final Connection connection = jdbc.getDataSource().getConnection();
                 final var statement = connection.createStatement();
                 final var result = statement.executeQuery("select status from tournament_broadcast_cover")) {
                assertTrue(result.next()); assertEquals("PENDING", result.getString(1));
            }
            try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                executor.submit(() -> new TransactionTemplate(transactions).execute(tx -> seasons.findLocked(seasonId)))
                        .get(3, TimeUnit.SECONDS);
            }
            return null;
        }).when(storage).put(anyString(), any());
        final String id = service.upload(seasonId, png());
        assertEquals("READY", covers.findById(id).orElseThrow().status);
        assertNotNull(covers.findById(id).orElseThrow().unreferencedAt);
    }

    @Test void failedPutAndFailedCleanupKeepDurableMetadataForRetry() throws Exception {
        doThrow(new ApiException(ApiErrorCode.BROADCAST_STORAGE_ERROR)).when(storage).put(anyString(), any());
        assertThrows(ApiException.class, () -> service.upload(seasonId, png()));
        final BroadcastCover cover = covers.findAll().getFirst();
        assertEquals("PENDING", cover.status);
        age(cover.id);
        doThrow(new ApiException(ApiErrorCode.BROADCAST_STORAGE_ERROR)).when(storage).delete(anyString());
        service.cleanup(); assertTrue(covers.existsById(cover.id));
        doNothing().when(storage).delete(anyString());
        service.cleanup(); assertFalse(covers.existsById(cover.id));
        verify(storage, org.mockito.Mockito.times(2)).delete(cover.objectKey);
    }

    @Test void onlyReadyReferencedVerifiedImagesArePublicAndDetachmentGetsAFreshGracePeriod() throws Exception {
        final MockMultipartFile file = png();
        final String id = service.upload(seasonId, file);
        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, assertThrows(ApiException.class, () -> service.load(id)).errorCode());
        attach(id);
        when(storage.get(anyString())).thenReturn(file.getBytes());
        assertArrayEquals(file.getBytes(), service.load(id).bytes());
        when(storage.get(anyString())).thenReturn(new byte[] {1, 2, 3});
        assertEquals(ApiErrorCode.BROADCAST_STORAGE_ERROR, assertThrows(ApiException.class, () -> service.load(id)).errorCode());
        age(id);
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            seasons.findLocked(seasonId).orElseThrow();
            jdbc.update("delete from tournament_broadcast_replay where cover_id=?", id);
            service.detach(id);
        });
        service.cleanup(); assertTrue(covers.existsById(id));
        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, assertThrows(ApiException.class, () -> service.load(id)).errorCode());
        jdbc.update("delete from tournament_broadcast_node where id=?", nodeId);
        jdbc.update("delete from tournament_broadcast_category where season_id=?", seasonId);
        jdbc.update("delete from tournament_broadcast_season where id=?", seasonId);
        assertNull(covers.findById(id).orElseThrow().seasonId);
        age(id); service.cleanup(); assertFalse(covers.existsById(id));
    }

    @Test void failedReplayReplacementRollsBackBothReferencesAndLeavesTheNewObjectRecoverable() throws Exception {
        final String oldId = service.upload(seasonId, png()); attach(oldId);
        final String replacement = service.upload(seasonId, png());
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            seasons.findLocked(seasonId).orElseThrow();
            service.attach(seasonId, replacement);
            jdbc.update("update tournament_broadcast_replay set cover_id=? where cover_id=?", replacement, oldId);
            service.detach(oldId);
            throw new IllegalStateException("Simulated business save failure");
        }));
        assertEquals(oldId, jdbc.queryForObject("select cover_id from tournament_broadcast_replay", String.class));
        assertNull(covers.findById(oldId).orElseThrow().unreferencedAt);
        assertNotNull(covers.findById(replacement).orElseThrow().unreferencedAt);
        assertEquals("READY", covers.findById(replacement).orElseThrow().status);
    }

    @Test void cleanupAndAttachmentSerializeSoADeletedObjectCannotBecomeReferenced() throws Exception {
        final String id = service.upload(seasonId, png()); age(id);
        final CountDownLatch deleting = new CountDownLatch(1);
        final CountDownLatch seasonLocked = new CountDownLatch(1);
        final CountDownLatch releaseDelete = new CountDownLatch(1);
        doAnswer(call -> {
            deleting.countDown();
            assertTrue(releaseDelete.await(5, TimeUnit.SECONDS));
            return null;
        }).when(storage).delete(anyString());
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var cleanup = executor.submit(service::cleanup);
            assertTrue(deleting.await(5, TimeUnit.SECONDS));
            final var attaching = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                seasons.findLocked(seasonId).orElseThrow();
                seasonLocked.countDown();
                service.attach(seasonId, id);
                insertReplay(id);
            }));
            assertTrue(seasonLocked.await(5, TimeUnit.SECONDS));
            releaseDelete.countDown();
            cleanup.get(5, TimeUnit.SECONDS);
            final var failure = assertThrows(java.util.concurrent.ExecutionException.class,
                    () -> attaching.get(5, TimeUnit.SECONDS));
            assertTrue(failure.getCause() instanceof ApiException);
            assertFalse(covers.existsById(id));
            assertEquals(0, jdbc.queryForObject("select count(*) from tournament_broadcast_replay", Integer.class));
        } finally { releaseDelete.countDown(); }
    }

    @Test void invalidImageOrMissingConfigurationNeverReservesAnObject() throws Exception {
        assertEquals(ApiErrorCode.BROADCAST_COVER_INVALID, assertThrows(ApiException.class,
                () -> service.upload(seasonId, new MockMultipartFile("cover", new byte[] {1,2,3}))).errorCode());
        when(storage.configured()).thenReturn(false);
        assertEquals(ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE,
                assertThrows(ApiException.class, () -> service.upload(seasonId, png())).errorCode());
        assertEquals(0, covers.count());
    }

    @Test void seasonDeletedBetweenPreflightAndReservationReturns404WithoutACloudWrite() throws Exception {
        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, assertThrows(ApiException.class,
                () -> service.upload(seasonId + 9999, png())).errorCode());
        assertEquals(0, covers.count());
        org.mockito.Mockito.verify(storage, org.mockito.Mockito.never()).put(anyString(), any());
    }

    private void attach(final String id) {
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            seasons.findLocked(seasonId).orElseThrow(); service.attach(seasonId, id); insertReplay(id);
        });
    }
    private void insertReplay(final String coverId) {
        jdbc.update("insert into tournament_broadcast_replay(node_id,title,url,match_date,day_number,group_label,teams,"
                + "perspective,cover_id,created_at) values (?,'Replay','https://example.test/video','2026-10-16',1,'A',"
                + "'[\"A\",\"B\"]'::jsonb,'POV',?,now())", nodeId, coverId);
    }
    private void age(final String id) {
        jdbc.update("update tournament_broadcast_cover set created_at=?,unreferenced_at=? where id=?",
                java.sql.Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)),
                java.sql.Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)), id);
    }
    private static MockMultipartFile png() throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(32,32,BufferedImage.TYPE_INT_RGB), "png", bytes);
        return new MockMultipartFile("cover", "misleading.exe", "application/octet-stream", bytes.toByteArray());
    }
}
