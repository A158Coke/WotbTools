package com.wotb.web.user;

import com.wotb.web.user.dto.UserProfileDto;
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

/**
 * Profile ensure 的真实 PostgreSQL 回归（account self-heal 的核心不变量）。
 *
 * <p>不靠 Mockito 假装并发正确：唯一约束冲突、PostgreSQL 的 aborted transaction 语义、
 * 「谁赢谁输」都必须在真实 PG（Testcontainers）上验证，否则测不出
 * 「败者读到胜者已提交的 profile」这条关键路径。</p>
 *
 * <p>覆盖：</p>
 * <ul>
 *   <li>A：无 profile 的已认证用户 → ensure 创建，且 keycloak_user_id = 当前 sub</li>
 *   <li>B：已有 profile → 重复 ensure 幂等，不新增、不改绑定</li>
 *   <li>C：两个并发 ensure（同 sub）→ 恰好 1 条 profile，两个调用方都成功</li>
 *   <li>D：真实 WotB 账号占用（KC B 声称 A 已绑定的 (EU, 100)）→ 仍返回
 *       WOTB_ACCOUNT_ALREADY_USED，且不产生被抢绑定的 B profile</li>
 *   <li>E：CN / QQ 普通用户 → CN + MANUAL；可信 WG claims → 对应区服 + WARGAMING</li>
 * </ul>
 */
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

    // ── A：缺失 → 创建 ────────────────────────────────────────────────────

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

    // ── B：已存在 → 幂等 ─────────────────────────────────────────────────

    @Test
    void repeatedEnsureIsIdempotentAndNeverMutatesBindings() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-01-02T03:04:05Z");
        seedProfile("kc-bound", "ASIA", 4242L, "BoundNick", "WARGAMING", verifiedAt);

        // 即使当前 JWT 的可信 claims 指向另一个区服/账号，也不得覆盖既有绑定。
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

    // ── C：并发 ensure → 恰好 1 条，双方都成功 ──────────────────────────

    @Test
    void concurrentEnsureLeavesExactlyOneProfileAndBothCallersSucceed() throws Exception {
        final int callers = 4;
        final ExecutorService pool = Executors.newFixedThreadPool(callers);
        final CountDownLatch start = new CountDownLatch(1);
        final AtomicReference<Throwable> failure = new AtomicReference<>();

        final Callable<UserProfileDto> ensure = () -> {
            // SecurityContext 是 thread-local：每个调用线程都要有自己的登录态。
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
            // 所有调用方都已就绪，同时放行，尽可能制造真实的唯一约束竞争窗口。
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
            // 1 KC sub → exactly 1 user_profile
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

    /**
     * trusted WG 新用户的并发收敛：这是「不能把 PostgreSQL 先报哪个约束当成业务正确性基础」的回归。
     *
     * <p>WG 新用户会同时携带 {@code keycloak_user_id} 与 {@code (wotb_server, wotb_account_id)}
     * 两个唯一键，因此同 sub 的并发插入，败者可能撞上其中任意一个约束，取决于数据库先检查哪一个。
     * 收敛判定必须是「重读自己的 sub」这一数据库事实，而不是约束名。</p>
     */
    @Test
    void concurrentTrustedWgEnsureLeavesExactlyOneProfileAndBothCallersSucceed() throws Exception {
        final int callers = 4;
        final ExecutorService pool = Executors.newFixedThreadPool(callers);
        final CountDownLatch start = new CountDownLatch(1);

        final Callable<UserProfileDto> ensure = () -> {
            // SecurityContext 是 thread-local：每个调用线程都要有自己的可信 WG 登录态。
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

            // all callers succeed / exactly one row / same profile id
            assertEquals(callers, results.size());
            assertEquals(1, userProfileRepository.count(),
                    "并发 trusted WG ensure 不得产生重复 profile 行");
            final Long expectedId = results.get(0).id();
            for (final UserProfileDto dto : results) {
                assertNotNull(dto, "每个调用方都必须拿到 profile");
                assertEquals(expectedId, dto.id(), "所有调用方必须收敛到同一条 profile");
                // canonical WG 语义在并发下也不能退化。
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

    // ── D：真实 WotB 账号冲突不得被吞掉 ─────────────────────────────────

    @Test
    void realWotbOwnershipCollisionIsNotSwallowedByIdempotency() {
        seedProfile("kc-a", "EU", 100L, "Owner", "WARGAMING", OffsetDateTime.now());

        // KC B 的可信 claims 声称 (EU, 100) —— 已经被 KC A 占用。
        loginAs("kc-b", "512345678", "Claimer", "EU", true, 100L);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> userProfileService.ensureCurrentProfile("kc-b", "512345678", "Claimer"));

        assertEquals("WOTB_ACCOUNT_ALREADY_USED", error.getMessage());
        // 不返回 A 的 profile，也不产生携带被抢绑定的 B profile。
        final Optional<UserProfile> forB = userProfileRepository.findByKeycloakUserId("kc-b");
        assertTrue(forB.isEmpty(), "冲突时绝不创建 B 的 profile");
        final UserProfile owner = userProfileRepository.findByKeycloakUserId("kc-a").orElseThrow();
        assertEquals(100L, owner.getWotbAccountId());
        assertEquals("Owner", owner.getWotbNickname());
        assertEquals(1, userProfileRepository.count());
    }

    // ── E：canonical provisioning 语义（CN/QQ 与可信 WG） ────────────────

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

    // ── helpers ──────────────────────────────────────────────────────────

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
