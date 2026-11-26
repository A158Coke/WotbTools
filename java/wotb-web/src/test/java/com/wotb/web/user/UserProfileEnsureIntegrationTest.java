package com.wotb.web.user;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.dto.OnboardingReceiptDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class UserProfileEnsureIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @DynamicPropertySource
    static void configure(final DynamicPropertyRegistry registry) {
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

    @Autowired
    UserProfileService userProfileService;

    @Autowired
    UserProfileRepository userProfileRepository;

    @Autowired
    PlatformTransactionManager transactionManager;

    @BeforeEach
    void clean() {
        userProfileRepository.deleteAll();
        userProfileRepository.flush();
        clearLogin();
    }

    @AfterEach
    void clearLogin() {
        SecurityContextHolder.clearContext();
    }


    @Test
    void ensureCreatesProfileForAuthenticatedUserWithoutOne() {
        loginAs("kc-new", "qq-user", "QQ Player", null, false, null);

        final UserProfileDto dto = userProfileService.ensureCurrentProfile(
                "kc-new", "qq-user", "QQ Player");

        assertEquals("kc-new", dto.keycloakUserId());
        assertEquals("qq-user", dto.username());
        assertEquals("CN", dto.wotbServer());
        assertEquals("MANUAL", dto.wotbAccountSource());
        assertEquals(1, userProfileRepository.count());
    }

    @Test
    void concurrentOnboardingReceiptsPersistTheMaximumEpochAndCompletedPrecedence() throws Exception {
        seedProfile("kc-onboarding", "CN", null, null, "MANUAL", null);
        final List<OnboardingReceiptDto> inputs = List.of(
                new OnboardingReceiptDto(3, "SKIPPED"), new OnboardingReceiptDto(2, "COMPLETED"),
                new OnboardingReceiptDto(3, "COMPLETED"), new OnboardingReceiptDto(1, "SKIPPED"));
        final CountDownLatch start = new CountDownLatch(1);
        try (final ExecutorService pool = Executors.newFixedThreadPool(inputs.size())) {
            final List<Future<OnboardingReceiptDto>> futures = inputs.stream()
                    .map(input -> pool.submit(() -> {
                        start.await();
                        return userProfileService.saveOnboardingReceipt("kc-onboarding", input.coreEpoch(), input.disposition());
                    })).toList();
            start.countDown();
            for (final Future<OnboardingReceiptDto> future : futures) {
                assertNotNull(future.get(30, TimeUnit.SECONDS));
            }
        }
        assertEquals(new OnboardingReceiptDto(3, "COMPLETED"), userProfileService.readOnboardingReceipt("kc-onboarding"));
        userProfileService.ensureCurrentProfile("kc-onboarding", "unused", "unused");
        assertEquals(new OnboardingReceiptDto(3, "COMPLETED"), userProfileService.readOnboardingReceipt("kc-onboarding"));
    }

    @Test
    void profileWriteLoadedBeforeOnboardingSaveCannotOverwriteItsReceipt() throws Exception {
        seedProfile("kc-onboarding", "CN", null, null, "MANUAL", null);
        final CountDownLatch read = new CountDownLatch(1);
        final CountDownLatch receiptSaved = new CountDownLatch(1);
        try (final ExecutorService pool = Executors.newSingleThreadExecutor()) {
            final Future<?> staleProfileWrite = pool.submit(() -> new TransactionTemplate(transactionManager)
                    .executeWithoutResult(status -> {
                        final UserProfile profile = userProfileRepository.findByKeycloakUserId("kc-onboarding").orElseThrow();
                        read.countDown();
                        try {
                            assertTrue(receiptSaved.await(30, TimeUnit.SECONDS));
                        } catch (final InterruptedException interrupted) {
                            Thread.currentThread().interrupt();
                            throw new IllegalStateException(interrupted);
                        }
                        profile.setDisplayName("Updated profile name");
                        userProfileRepository.save(profile);
                    }));
            try {
                assertTrue(read.await(30, TimeUnit.SECONDS));
                userProfileService.saveOnboardingReceipt("kc-onboarding", 2, "COMPLETED");
            } finally {
                receiptSaved.countDown();
            }
            staleProfileWrite.get(30, TimeUnit.SECONDS);
        }
        assertEquals(new OnboardingReceiptDto(2, "COMPLETED"), userProfileService.readOnboardingReceipt("kc-onboarding"));
        assertEquals("Updated profile name", userProfileRepository.findByKeycloakUserId("kc-onboarding").orElseThrow().getDisplayName());
    }


    @Test
    void repeatedEnsureIsIdempotentAndNeverMutatesBindings() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-01-02T03:04:05Z");
        seedProfile("kc-bound", "ASIA", 4242L, "BoundNick", "WARGAMING", verifiedAt);

        loginAs("kc-bound", "512345678", "PlayerOne", "EU", true, 999L);
        final UserProfileDto first = userProfileService.ensureCurrentProfile(
                "kc-bound", "512345678", "PlayerOne");
        final UserProfileDto second = userProfileService.ensureCurrentProfile(
                "kc-bound", "512345678", "PlayerOne");

        assertEquals(first.id(), second.id());
        assertEquals("ASIA", second.wotbServer());
        assertEquals(4242L, second.wotbAccountId());
        assertEquals("BoundNick", second.wotbNickname());
        assertEquals("WARGAMING", second.wotbAccountSource());
        assertEquals(verifiedAt, second.wotbAccountVerifiedAt());
        assertEquals(1, userProfileRepository.count());
    }


    @Test
    void concurrentEnsureLeavesExactlyOneProfileAndBothCallersSucceed() throws Exception {
        final int callers = 4;
        final ExecutorService pool = Executors.newFixedThreadPool(callers);
        final CountDownLatch start = new CountDownLatch(1);
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        final Callable<UserProfileDto> ensure = () -> {
            loginAs("kc-race", "512345678", "Racer", null, false, null);
            try {
                start.await();
                return userProfileService.ensureCurrentProfile("kc-race", "512345678", "Racer");
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        try {
            final List<Future<UserProfileDto>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < callers; i++) {
                futures.add(pool.submit(ensure));
            }
            start.countDown();

            final List<UserProfileDto> results = new java.util.ArrayList<>();
            for (final Future<UserProfileDto> future : futures) {
                try {
                    results.add(future.get(30, TimeUnit.SECONDS));
                } catch (final Exception e) {
                    failure.compareAndSet(null, e);
                }
            }

            if (failure.get() != null) {
                throw new AssertionError("并发 ensure 的调用方不得失败（败者必须幂等成功）", failure.get());
            }
            assertEquals(callers, results.size());
            for (final UserProfileDto dto : results) {
                assertNotNull(dto, "每个调用方都必须拿到 profile");
            }
            assertEquals(1, userProfileRepository.count(),
                    "并发 ensure 不得产生重复 profile 行");
            final Long expectedId = results.get(0).id();
            for (final UserProfileDto dto : results) {
                assertEquals(expectedId, dto.id(), "所有调用方必须收敛到同一条 profile");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void concurrentTrustedWgEnsureLeavesExactlyOneProfileAndBothCallersSucceed() throws Exception {
        final int callers = 4;
        final ExecutorService pool = Executors.newFixedThreadPool(callers);
        final CountDownLatch start = new CountDownLatch(1);

        final Callable<UserProfileDto> ensure = () -> {
            loginAs("kc-wg-race", "512345678", "PlayerOne", "EU", true, 100L);
            try {
                start.await();
                return userProfileService.ensureCurrentProfile("kc-wg-race", "512345678", "PlayerOne");
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        try {
            final List<Future<UserProfileDto>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < callers; i++) {
                futures.add(pool.submit(ensure));
            }
            start.countDown();

            final List<UserProfileDto> results = new java.util.ArrayList<>();
            final AtomicReference<Throwable> failure = new AtomicReference<>();
            for (final Future<UserProfileDto> future : futures) {
                try {
                    results.add(future.get(30, TimeUnit.SECONDS));
                } catch (final Exception e) {
                    failure.compareAndSet(null, e);
                }
            }
            if (failure.get() != null) {
                throw new AssertionError("并发 trusted WG ensure 的调用方不得失败", failure.get());
            }

            assertEquals(callers, results.size());
            assertEquals(1, userProfileRepository.count(),
                    "并发 trusted WG ensure 不得产生重复 profile 行");
            final Long expectedId = results.get(0).id();
            for (final UserProfileDto dto : results) {
                assertNotNull(dto, "每个调用方都必须拿到 profile");
                assertEquals(expectedId, dto.id(), "所有调用方必须收敛到同一条 profile");
                assertEquals("EU", dto.wotbServer());
                assertEquals(100L, dto.wotbAccountId());
                assertEquals("PlayerOne", dto.wotbNickname());
                assertEquals("WARGAMING", dto.wotbAccountSource());
                assertNotNull(dto.wotbAccountVerifiedAt());
            }
        } finally {
            pool.shutdownNow();
        }
    }


    @Test
    void realWotbOwnershipCollisionIsNotSwallowedByIdempotency() {
        seedProfile("kc-a", "EU", 100L, "Owner", "WARGAMING", OffsetDateTime.now());

        loginAs("kc-b", "512345678", "Claimer", "EU", true, 100L);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> userProfileService.ensureCurrentProfile("kc-b", "512345678", "Claimer"));

        assertEquals("WOTB_ACCOUNT_ALREADY_USED", error.getMessage());
        final Optional<UserProfile> forB = userProfileRepository.findByKeycloakUserId("kc-b");
        assertTrue(forB.isEmpty(), "冲突时绝不创建 B 的 profile");
        final UserProfile owner = userProfileRepository.findByKeycloakUserId("kc-a").orElseThrow();
        assertEquals(100L, owner.getWotbAccountId());
        assertEquals("Owner", owner.getWotbNickname());
        assertEquals(1, userProfileRepository.count());
    }


    @Test
    void ensureForNonWgUserStaysCnManual() {
        loginAs("kc-qq", "qq-user", "QQ Player", null, false, null);

        final UserProfileDto dto = userProfileService.ensureCurrentProfile(
                "kc-qq", "qq-user", "QQ Player");

        assertEquals("CN", dto.wotbServer());
        assertEquals("MANUAL", dto.wotbAccountSource());
        assertNull(dto.wotbAccountId());
        assertNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void ensureForTrustedWgClaimsCreatesWargamingProfile() {
        loginAs("kc-wg", "512345678", "PlayerOne", "EU", true, 777L);

        final UserProfileDto dto = userProfileService.ensureCurrentProfile(
                "kc-wg", "512345678", "PlayerOne");

        assertEquals("EU", dto.wotbServer());
        assertEquals(777L, dto.wotbAccountId());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }


    private void seedProfile(final String keycloakUserId,
                             final String server,
                             final Long accountId,
                             final String nickname,
                             final String source,
                             final OffsetDateTime verifiedAt) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setUsername(keycloakUserId);
        profile.setDisplayName(keycloakUserId);
        profile.setWotbServer(server);
        profile.setWotbAccountId(accountId);
        profile.setWotbNickname(nickname);
        profile.setWotbAccountSource(source);
        profile.setWotbAccountVerifiedAt(verifiedAt);
        profile.setUpdatedAt(OffsetDateTime.now());
        userProfileRepository.saveAndFlush(profile);
    }

    private static void loginAs(final String subject,
                                final String username,
                                final String displayName,
                                final String region,
                                final boolean verified,
                                final Long accountId) {
        final Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject(subject)
                .claim("preferred_username", username)
                .claim("displayName", displayName)
                .claim("wotb_region", region)
                .claim("wotb_account_id", accountId == null ? null : String.valueOf(accountId))
                .claim("wotb_nickname", displayName)
                .claim("wotb_verified", verified)
                .build();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(jwt, null));
    }
}
