package com.wotb.web.creator;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.wotb.web.admin.service.AdminUserService;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.entity.CreatorAvatar;
import com.wotb.web.creator.repository.CreatorAvatarRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.repository.CreatorSettingsRepository;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.AfterEach;
import org.apache.http.client.methods.HttpRequestBase;
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
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;
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
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.IntStream;
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
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real PostgreSQL transactions and fake COS bytes, without cloud credentials. */
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
    @MockitoSpyBean CreatorAvatarRepository reservations;
    @Autowired CreatorService service;
    @Autowired AdminUserService adminUsers;
    @MockitoBean KeycloakAdminUserService keycloakUsers;
    @Autowired CreatorRepository creators;
    @Autowired CreatorSettingsRepository settings;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @Autowired COSClient client;
    @Autowired WebApplicationContext web;
    @PersistenceContext EntityManager entityManager;
    private final ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
    private MockMvc mvc;

    @BeforeEach void setup() throws Exception {
        jdbc.execute("truncate creator, creator_avatar, creator_category, creator_level restart identity cascade");
        jdbc.update("insert into creator_category(name) values ('A'),('B')");
        reset(client, keycloakUsers);
        objects.clear();
        doAnswer(call -> { objects.put(call.getArgument(1), ((InputStream) call.getArgument(2)).readAllBytes()); return null; })
                .when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
        doAnswer(call -> {
            final byte[] bytes = objects.get((String) call.getArgument(1));
            if (bytes == null) { final var error = new com.qcloud.cos.exception.CosServiceException("missing"); error.setStatusCode(404); throw error; }
            final COSObject object = new COSObject();
            object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(bytes), mock(HttpRequestBase.class)));
            return object;
        }).when(client).getObject(anyString(), anyString());
        doAnswer(call -> { objects.remove((String) call.getArgument(1)); return null; })
                .when(client).deleteObject(anyString(), anyString());
        login("uploader");
        mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
    }
    @AfterEach void clearIdentity() { SecurityContextHolder.clearContext(); }

    @Test void durableReservationPrecedesPutWhichDoesNotLockDirectoryOrCreators() throws Exception {
        final long creator = service.create(save(null)).id();
        doAnswer(call -> {
            try (final Connection connection = jdbc.getDataSource().getConnection();
                 final var statement = connection.createStatement();
                 final var rows = statement.executeQuery("select status from creator_avatar")) {
                assertTrue(rows.next()); assertEquals("PENDING", rows.getString(1));
            }
            try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                    settings.findExclusive(); creators.findLocked(creator).orElseThrow();
                })).get(3, TimeUnit.SECONDS);
            }
            return null;
        }).when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
        final CreatorDtos.Avatar uploaded = avatars.upload(png());
        assertEquals("READY", reservations.findById(uploaded.id()).orElseThrow().status);
        assertNotNull(reservations.findById(uploaded.id()).orElseThrow().unreferencedAt);
        assertEquals("/api/creators/avatars/" + uploaded.id(), uploaded.url());
        assertTrue(service.settings().avatarUploadsAvailable());
    }

    @Test void failedPutAndFailedCleanupKeepMetadataForRetry() throws Exception {
        doThrow(new CosClientException("fake failure")).when(client)
                .putObject(anyString(), anyString(), any(InputStream.class), any());
        assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE,
                assertThrows(ApiException.class, () -> avatars.upload(png())).errorCode());
        final CreatorAvatar reservation = reservations.findAll().getFirst();
        assertEquals("PENDING", reservation.status);
        age(reservation.id);
        doThrow(new CosClientException("fake delete failure")).when(client).deleteObject(anyString(), anyString());
        avatars.cleanup(); assertTrue(reservations.existsById(reservation.id));
        doAnswer(call -> null).when(client).deleteObject(anyString(), anyString());
        avatars.cleanup(); assertFalse(reservations.existsById(reservation.id));
    }

    @Test void publicReadsRequireAttachedReadyAndIntegrityCheckedBytesAndReleaseConnectionBeforeIo() throws Exception {
        final MockMultipartFile image = png();
        final String avatar = avatars.upload(image).id();
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND,
                assertThrows(ApiException.class, () -> avatars.load(avatar)).errorCode());
        final long creator = service.create(save(avatar)).id();
        assertEquals(avatar, service.detail(creator).avatarId());
        assertEquals("/api/creators/avatars/" + avatar, service.list(null).getFirst().avatarUrl());
        doAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                executor.submit(() -> new TransactionTemplate(transactions).execute(tx -> reservations.findLocked(avatar)))
                        .get(3, TimeUnit.SECONDS);
            }
            final COSObject object = new COSObject();
            object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(image.getBytes()), mock(HttpRequestBase.class)));
            return object;
        }).when(client).getObject(anyString(), anyString());
        assertArrayEquals(image.getBytes(), avatars.load(avatar).bytes());
        mvc.perform(get("/api/creators/avatars/" + avatar)).andExpect(status().isOk())
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        objects.put(PREFIX + avatar, new byte[] {1, 2, 3});
        doAnswer(call -> {
            final COSObject object = new COSObject();
            object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(new byte[] {1,2,3}), mock(HttpRequestBase.class)));
            return object;
        }).when(client).getObject(anyString(), anyString());
        assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE,
                assertThrows(ApiException.class, () -> avatars.load(avatar)).errorCode());
    }

    @Test void reservationOwnerAndReferenceRulesPreventReusingOrDeletingAnotherCreatorsImage() throws Exception {
        final String avatar = avatars.upload(png()).id();
        login("other-admin");
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND,
                assertThrows(ApiException.class, () -> service.create(save(avatar))).errorCode());
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND,
                assertThrows(ApiException.class, () -> avatars.release(avatar)).errorCode());
        login("uploader");
        final long creator = service.create(save(avatar)).id();
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                assertThrows(ApiException.class, () -> service.create(save(avatar))).errorCode());
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                assertThrows(ApiException.class, () -> avatars.release(avatar)).errorCode());
        login("other-admin");
        assertEquals(avatar, service.update(creator, save(avatar)).avatarId());
        service.update(creator, save(null));
        assertNotNull(reservations.findById(avatar).orElseThrow().unreferencedAt);
        login("uploader");
        avatars.release(avatar);
        assertFalse(reservations.existsById(avatar)); assertFalse(objects.containsKey(PREFIX + avatar));
    }

    @Test void failedBusinessSaveRollsBackReferencesAndReplacementAndDeleteStartFreshGracePeriods() throws Exception {
        final String old = avatars.upload(png()).id();
        final long creator = service.create(save(old)).id();
        final String replacement = avatars.upload(png()).id();
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            service.update(creator, save(replacement)); throw new IllegalStateException("fake transaction failure");
        }));
        assertEquals(old, service.detail(creator).avatarId());
        assertNull(reservations.findById(old).orElseThrow().unreferencedAt);
        assertNotNull(reservations.findById(replacement).orElseThrow().unreferencedAt);
        age(old);
        service.update(creator, save(replacement));
        avatars.cleanup(); assertTrue(reservations.existsById(old));
        age(old); avatars.cleanup(); assertFalse(reservations.existsById(old));
        service.delete(creator);
        assertNotNull(reservations.findById(replacement).orElseThrow().unreferencedAt);
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND,
                assertThrows(ApiException.class, () -> avatars.load(replacement)).errorCode());
        age(replacement); avatars.cleanup(); assertFalse(reservations.existsById(replacement));
    }

    @Test void cleanupAndAttachSerializeAndLateAttachCannotResurrectDeletedObject() throws Exception {
        final String avatar = avatars.upload(png()).id(); age(avatar);
        final CountDownLatch deleting = new CountDownLatch(1);
        final CountDownLatch attaching = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        doAnswer(call -> { deleting.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return null; })
                .when(client).deleteObject(anyString(), anyString());
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var cleanup = executor.submit(avatars::cleanup);
            assertTrue(deleting.await(5, TimeUnit.SECONDS));
            final var attach = executor.submit(() -> {
                login("uploader");
                try { return new TransactionTemplate(transactions).execute(tx -> {
                    settings.findExclusive(); attaching.countDown(); return service.create(save(avatar));
                }); }
                finally { SecurityContextHolder.clearContext(); }
            });
            assertTrue(attaching.await(5, TimeUnit.SECONDS));
            release.countDown();
            cleanup.get(5, TimeUnit.SECONDS);
            assertTrue(assertThrows(ExecutionException.class, () -> attach.get(5, TimeUnit.SECONDS)).getCause() instanceof ApiException);
            assertFalse(reservations.existsById(avatar)); assertEquals(0, creators.count());
        } finally { release.countDown(); }
    }

    @Test void invalidImagesNeverReserveAndMetadataCannotCauseCrossNamespaceDeletion() throws Exception {
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST,
                assertThrows(ApiException.class, () -> avatars.upload(new MockMultipartFile("file", new byte[] {1,2,3}))).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("file", new byte[10 * 1024 * 1024 + 1]))).errorCode());
        assertEquals(0, reservations.count());
        final String avatar = avatars.upload(png()).id(); age(avatar);
        final String otherObject = "league-broadcasts/covers/" + UUID.randomUUID();
        objects.put(otherObject, new byte[] {9});
        jdbc.update("update creator_avatar set object_key=? where id=?", otherObject, avatar);
        avatars.cleanup();
        assertTrue(reservations.existsById(avatar)); assertTrue(objects.containsKey(otherObject));
    }

    @Test void httpUploadAndReleaseRequireRealTournamentAuthority() throws Exception {
        SecurityContextHolder.clearContext();
        final String avatar = UUID.randomUUID().toString();
        mvc.perform(multipart("/api/admin/creators/avatars").file(png())).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/admin/creators/avatars").file(png()).with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/creators/avatars/" + avatar).with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(multipart("/api/admin/creators/avatars").file(png()).with(jwt().jwt(token -> token.subject("uploader"))
                        .authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.id").isString()).andExpect(jsonPath("$.url").isString());
        final String uploaded = reservations.findAll().getFirst().id;
        mvc.perform(delete("/api/admin/creators/avatars/" + uploaded).with(jwt().jwt(token -> token.subject("uploader"))
                        .authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isNoContent());
    }

    @Test void accountDeletionAnonymizesOwnersKeepsPublicImagesAndQueuesOnlyUnreferencedObjects() throws Exception {
        final MockMultipartFile image = png();
        final String attached = avatars.upload(image).id();
        final String unused = avatars.upload(image).id();
        final long creator = service.create(save(attached)).id();
        login("other-admin");
        final String other = avatars.upload(image).id();

        assertEquals(1, adminUsers.deleteUsers(List.of("uploader"), true, adminJwt()).deleted());

        assertNull(reservations.findById(attached).orElseThrow().subject);
        assertNull(reservations.findById(unused).orElseThrow().subject);
        assertEquals("other-admin", reservations.findById(other).orElseThrow().subject);
        assertEquals(attached, service.detail(creator).avatarId());
        assertArrayEquals(image.getBytes(), avatars.load(attached).bytes());
        verify(client, never()).deleteObject(anyString(), anyString());
        assertEquals(attached, service.update(creator, save(attached)).avatarId());
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND,
                assertThrows(ApiException.class, () -> service.create(save(attached))).errorCode());

        avatars.cleanup();
        assertFalse(reservations.existsById(unused));
        assertFalse(objects.containsKey(PREFIX + unused));
        assertTrue(reservations.existsById(attached));
        assertTrue(reservations.existsById(other));
        service.update(creator, save(other));
        avatars.cleanup();
        assertFalse(reservations.existsById(attached));
        assertFalse(objects.containsKey(PREFIX + attached));
        assertEquals(other, service.detail(creator).avatarId());
        assertArrayEquals(image.getBytes(), avatars.load(other).bytes());
    }

    @Test void keycloakFailureRollsBackAvatarAnonymizationWithoutDeletingImagesOrReferences() throws Exception {
        final String attached = avatars.upload(png()).id();
        final String unused = avatars.upload(png()).id();
        final long creator = service.create(save(attached)).id();
        doThrow(new IllegalStateException("keycloak unavailable")).when(keycloakUsers).deleteUser("uploader");

        final var result = adminUsers.deleteUsers(List.of("uploader"), true, adminJwt());

        assertEquals("FAILED_KEYCLOAK_DELETE", result.results().getFirst().errorCode());
        assertEquals("uploader", reservations.findById(attached).orElseThrow().subject);
        assertEquals("uploader", reservations.findById(unused).orElseThrow().subject);
        assertEquals(attached, service.detail(creator).avatarId());
        assertTrue(objects.containsKey(PREFIX + attached));
        assertTrue(objects.containsKey(PREFIX + unused));
        avatars.cleanup();
        assertTrue(reservations.existsById(unused));
        verify(client, never()).deleteObject(anyString(), anyString());
    }

    @Test void failedAnonymousCleanupKeepsDeidentifiedMetadataForTheNextBatch() throws Exception {
        final String unused = avatars.upload(png()).id();
        service.removeDataForAccountDeletion("uploader");
        doThrow(new CosClientException("fake unavailable storage")).when(client).deleteObject(anyString(), anyString());

        avatars.cleanup();

        assertNull(reservations.findById(unused).orElseThrow().subject);
        assertTrue(objects.containsKey(PREFIX + unused));
        doAnswer(call -> { objects.remove((String) call.getArgument(1)); return null; })
                .when(client).deleteObject(anyString(), anyString());
        avatars.cleanup();
        assertFalse(reservations.existsById(unused));
        assertFalse(objects.containsKey(PREFIX + unused));
    }

    @Test void failedOldBatchRotatesPersistentlySoLaterExpiredAvatarsAreNotStarved() throws Exception {
        final List<String> failed = IntStream.range(0, 100).mapToObj(index -> {
            final String id = UUID.randomUUID().toString();
            final String key = "retired-creator-avatars/" + id;
            jdbc.update("""
                    insert into creator_avatar(id,keycloak_subject,object_key,status,content_type,size,hash,created_at,unreferenced_at)
                    values (?,'uploader',?,'READY','image/png',1,repeat('a',64),now()-interval '48 hours',now()-interval '48 hours')
                    """, id, key);
            objects.put(key, new byte[] {1});
            return id;
        }).toList();
        final String later = avatars.upload(png()).id();
        age(later);

        avatars.cleanup();

        assertEquals(101, reservations.count());
        assertTrue(objects.containsKey(PREFIX + later));
        assertEquals(100, jdbc.queryForObject("select count(*) from creator_avatar where last_cleanup_attempt_at is not null", Integer.class));
        verify(client, never()).deleteObject(anyString(), anyString());

        avatars.cleanup();

        assertFalse(reservations.existsById(later));
        assertFalse(objects.containsKey(PREFIX + later));
        assertEquals(100, reservations.count());
        assertTrue(failed.stream().allMatch(id -> objects.containsKey("retired-creator-avatars/" + id)));
        assertEquals(100, jdbc.queryForObject("select count(*) from creator_avatar where keycloak_subject='uploader'", Integer.class));
        verify(client, times(1)).deleteObject(anyString(), anyString());
    }

    @Test void attemptWriteFailureKeepsMetadataAndDoesNotAbortTheRemainingCleanupBatch() throws Exception {
        final String blocked = avatars.upload(png()).id();
        final String blockedKey = "retired-creator-avatars/" + blocked;
        final String later = avatars.upload(png()).id();
        jdbc.update("update creator_avatar set object_key=?,created_at=now()-interval '48 hours',"
                + "unreferenced_at=now()-interval '48 hours' where id=?", blockedKey, blocked);
        objects.put(blockedKey, objects.remove(PREFIX + blocked));
        age(later);
        jdbc.execute("""
                create function creator_avatar_test_reject_attempt() returns trigger language plpgsql as $$
                begin raise exception 'test attempt write failure'; end; $$
                """);
        jdbc.execute("create trigger creator_avatar_test_reject_attempt before update of last_cleanup_attempt_at "
                + "on creator_avatar for each row execute function creator_avatar_test_reject_attempt()");
        try {
            avatars.cleanup();

            final CreatorAvatar preserved = reservations.findById(blocked).orElseThrow();
            assertEquals("uploader", preserved.subject);
            assertEquals(blockedKey, preserved.objectKey);
            assertNull(preserved.lastCleanupAttemptAt);
            assertTrue(objects.containsKey(blockedKey));
            assertFalse(reservations.existsById(later));
            assertFalse(objects.containsKey(PREFIX + later));
            verify(client, times(1)).deleteObject(anyString(), anyString());
        } finally {
            jdbc.execute("drop trigger creator_avatar_test_reject_attempt on creator_avatar");
            jdbc.execute("drop function creator_avatar_test_reject_attempt()");
        }
    }

    @Test void localConstraintFailureRollsBackAvatarAnonymizationAndDoesNotDeleteCosObjects() throws Exception {
        final String attached = avatars.upload(png()).id();
        final String unused = avatars.upload(png()).id();
        final long creator = service.create(save(attached)).id();

        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                    service.removeDataForAccountDeletion("uploader");
                    assertNull(reservations.findById(attached).orElseThrow().subject);
                    jdbc.update("update creator set base_stars=0 where id=?", creator);
                }));

        assertEquals("uploader", reservations.findById(attached).orElseThrow().subject);
        assertEquals("uploader", reservations.findById(unused).orElseThrow().subject);
        assertEquals(attached, service.detail(creator).avatarId());
        assertTrue(objects.containsKey(PREFIX + attached));
        assertTrue(objects.containsKey(PREFIX + unused));
        verify(client, never()).deleteObject(anyString(), anyString());
    }

    @Test void accountDeletionWaitsForReservationCommitAndPutRejectsTheAnonymizedReservation() throws Exception {
        final CountDownLatch reserved = new CountDownLatch(1);
        final CountDownLatch commitReservation = new CountDownLatch(1);
        final CountDownLatch deletionStarted = new CountDownLatch(1);
        final CountDownLatch deletionDone = new CountDownLatch(1);
        doAnswer(call -> {
            final CreatorAvatar saved = call.getArgument(0);
            entityManager.persist(saved);
            entityManager.flush();
            reserved.countDown();
            assertTrue(commitReservation.await(10, TimeUnit.SECONDS));
            return saved;
        }).when(reservations).saveAndFlush(any(CreatorAvatar.class));
        doAnswer(call -> {
            if ("avatar-upload-repair".equals(Thread.currentThread().getName())) {
                assertTrue(deletionDone.await(10, TimeUnit.SECONDS));
            }
            return Optional.ofNullable(entityManager.find(CreatorAvatar.class, call.getArgument(0), LockModeType.PESSIMISTIC_WRITE));
        }).when(reservations).findLocked(anyString());
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var upload = executor.submit(() -> {
                Thread.currentThread().setName("avatar-upload-repair");
                login("uploader");
                try { return avatars.upload(png()); }
                finally { SecurityContextHolder.clearContext(); }
            });
            assertTrue(reserved.await(10, TimeUnit.SECONDS));
            final var deletion = executor.submit(() -> {
                deletionStarted.countDown();
                try { service.removeDataForAccountDeletion("uploader"); }
                finally { deletionDone.countDown(); }
            });
            assertTrue(deletionStarted.await(10, TimeUnit.SECONDS));
            try { assertThrows(TimeoutException.class, () -> deletion.get(300, TimeUnit.MILLISECONDS)); }
            finally { commitReservation.countDown(); }
            deletion.get(10, TimeUnit.SECONDS);
            final var failure = assertThrows(ExecutionException.class, () -> upload.get(10, TimeUnit.SECONDS));
            assertTrue(failure.getCause() instanceof ApiException);
            assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND, ((ApiException) failure.getCause()).errorCode());
            assertNull(reservations.findAll().getFirst().subject);
            assertEquals("PENDING", reservations.findAll().getFirst().status);
            verify(client, never()).putObject(anyString(), anyString(), any(InputStream.class), any());
            avatars.cleanup();
            assertEquals(0, reservations.count());
        } finally { commitReservation.countDown(); deletionDone.countDown(); }
    }

    private static Jwt adminJwt() {
        return Jwt.withTokenValue("test-admin").header("alg", "none").subject("admin").build();
    }
    private void age(final String id) {
        jdbc.update("update creator_avatar set created_at=?,unreferenced_at=? where id=?",
                java.sql.Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)),
                java.sql.Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)), id);
    }
    private static CreatorDtos.SaveRequest save(final String avatar) {
        return new CreatorDtos.SaveRequest("Creator", null, "https://space.bilibili.com/123", List.of(1L), null, 3, avatar);
    }
    private static void login(final String subject) {
        final Jwt token = Jwt.withTokenValue("test").header("alg", "none").subject(subject).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(token));
    }
    private static MockMultipartFile png() throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return new MockMultipartFile("file", "not-an-image.exe", "application/octet-stream", bytes.toByteArray());
    }
}
