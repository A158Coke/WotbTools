package com.wotb.web.creator;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
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
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
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
    @Autowired CreatorAvatarRepository reservations;
    @Autowired CreatorService service;
    @Autowired CreatorRepository creators;
    @Autowired CreatorSettingsRepository settings;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @Autowired COSClient client;
    @Autowired WebApplicationContext web;
    private final ConcurrentHashMap<String, byte[]> objects = new ConcurrentHashMap<>();
    private MockMvc mvc;

    @BeforeEach void setup() throws Exception {
        jdbc.execute("truncate creator, creator_avatar, creator_category, creator_level restart identity cascade");
        jdbc.update("insert into creator_category(name) values ('A'),('B')");
        reset(client);
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
