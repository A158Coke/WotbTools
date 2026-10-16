package com.wotb.web.creator;

import com.wotb.web.admin.service.AdminUserService;
import com.wotb.web.config.KeycloakAdminUserService;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.repository.CreatorSettingsRepository;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

/** PostgreSQL proves lock ordering, relation uniqueness, FK/CHECK behavior and atomic rewards. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class CreatorIntegrationTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    @DynamicPropertySource
    static void properties(final DynamicPropertyRegistry registry) {
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
    @Autowired CreatorService service;
    @Autowired CreatorRepository creators;
    @Autowired CreatorSettingsRepository settings;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @Autowired AdminUserService adminUsers;
    @MockitoBean KeycloakAdminUserService keycloakUsers;
    @BeforeAll
    static void migrationSeedsOnlyOnce(@Autowired final JdbcTemplate jdbc) {
        assertEquals(List.of("单车高伤回放类", "单车实况类", "直播类", "联赛类", "高手/大神类", "娱乐类"),
                jdbc.queryForList("select name from creator_category order by id", String.class));
        assertEquals(List.of("普通", "高手", "职业级", "殿堂级"),
                jdbc.queryForList("select name from creator_level order by id", String.class));
        jdbc.update("delete from creator_category where id=6");
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()).load().migrate();
        assertEquals(5, jdbc.queryForObject("select count(*) from creator_category", Integer.class));
    }
    @BeforeEach
    void reset() {
        jdbc.execute("truncate creator, creator_category, creator_level, creator_category_link, creator_favorite restart identity cascade");
        jdbc.execute("truncate user_profile, admin_user_log restart identity cascade");
        jdbc.update("update creator_settings set favorite_threshold=null where id=1");
        jdbc.update("insert into creator_category(name) values ('A'),('B'),('C')");
        jdbc.update("insert into creator_level(name) values ('Basic'),('Expert')");
    }
    @Test void schemaUsesRealConstraintsAndSafeDefaultsWithoutProfileDependency() {
        assertEquals(200, service.settings().favoriteThreshold());
        assertFalse(service.settings().avatarUploadsAvailable());
        final long id = create(3, List.of(1L), null).id();
        assertEquals(6, card(id).score());
        assertEquals(0, card(id).favoriteCount());
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set base_stars=0 where id=?", id));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> jdbc.update("update creator_settings set favorite_threshold=0 where id=1"));
        service.favorite("jwt-only-no-profile", id, true);
        assertEquals(1, card(id).favoriteCount());
        assertEquals(0, jdbc.queryForObject("select count(*) from user_profile", Integer.class));
    }
    @Test void duplicateConcurrentFirstFavoriteIsOneHistoryOneCountAndOneContribution() throws Exception {
        service.configure(new CreatorDtos.SettingsRequest(1));
        final long id = create(3, List.of(1L, 2L), null).id();
        race(() -> service.favorite("same-user", id, true), () -> service.favorite("same-user", id, true));
        assertEquals(1, card(id).favoriteCount());
        assertEquals(7, card(id).score());
        assertEquals(1, jdbc.queryForObject("select count(*) from creator_favorite where creator_id=?", Integer.class, id));
        assertEquals(List.of(id), service.favorites("same-user").creatorIds());
        assertEquals(id, service.list(2L).getFirst().id());
        assertEquals(2, service.list(1L).getFirst().categories().size());
    }
    @Test void concurrentDifferentUsersCrossThresholdWithoutDoubleOrLostReward() throws Exception {
        service.configure(new CreatorDtos.SettingsRequest(2));
        final long id = create(3, List.of(1L), null).id();
        race(() -> service.favorite("a", id, true), () -> service.favorite("b", id, true));
        assertEquals(2, card(id).favoriteCount());
        assertEquals(7, card(id).score());
        assertEquals(0, counter(id, "cycle_count"));
        assertEquals(1, counter(id, "reward_points"));
    }
    @Test void cancelAndRefavoriteNeverReawardOrReduceProgressEvenAtZero() throws Exception {
        service.configure(new CreatorDtos.SettingsRequest(1));
        final long id = create(3, List.of(1L), null).id();
        service.favorite("a", id, true);
        race(() -> service.favorite("a", id, false), () -> service.favorite("a", id, false));
        assertEquals(0, card(id).favoriteCount());
        assertEquals(0, counter(id, "cycle_count"));
        assertEquals(7, card(id).score());
        service.favorite("a", id, true);
        service.favorite("a", id, true);
        assertEquals(1, card(id).favoriteCount());
        assertEquals(7, card(id).score());
        assertEquals(0, counter(id, "cycle_count"));
    }
    @Test void defaultThresholdBoundariesCapAndContinueCountingCurrentFavorites() {
        final long id = create(3, List.of(1L), null).id();
        jdbc.update("update creator set favorite_count=198, cycle_count=198 where id=?", id);
        assertEquals(6, service.favorite("u199", id, true).creator().score());
        assertEquals(7, service.favorite("u200", id, true).creator().score());
        assertEquals(0, counter(id, "cycle_count"));
        jdbc.update("update creator set favorite_count=399, cycle_count=199, reward_points=1 where id=?", id);
        assertEquals(8, service.favorite("u400", id, true).creator().score());
        jdbc.update("update creator set favorite_count=799, cycle_count=199, reward_points=3 where id=?", id);
        assertEquals(10, service.favorite("u800", id, true).creator().score());
        assertEquals(10, service.favorite("u801", id, true).creator().score());
        assertEquals(801, card(id).favoriteCount());
        assertEquals(0, counter(id, "cycle_count"));
    }
    @Test void thresholdChangePreservesRemainderAndOnlyNextFirstFavoriteSettlesIt() {
        final long id = create(3, List.of(1L), null).id();
        jdbc.update("update creator set cycle_count=150 where id=?", id);
        service.configure(new CreatorDtos.SettingsRequest(100));
        assertEquals(150, counter(id, "cycle_count"));
        assertEquals(6, card(id).score());
        service.favorite("new", id, true);
        assertEquals(7, card(id).score());
        assertEquals(51, counter(id, "cycle_count"));
        service.configure(new CreatorDtos.SettingsRequest(500));
        assertEquals(7, card(id).score());
        assertEquals(51, counter(id, "cycle_count"));
        service.favorite("another", id, true);
        assertEquals(52, counter(id, "cycle_count"));
        assertEquals(7, card(id).score());
    }
    @Test void cappedSettlementRetainsMultipleThresholdsAndPausedHistoryIsNeverBackfilled() {
        final long id = create(4, List.of(1L), null).id();
        jdbc.update("update creator set reward_points=1, cycle_count=450 where id=?", id);
        service.configure(new CreatorDtos.SettingsRequest(100));
        service.favorite("new", id, true);
        assertEquals(10, card(id).score());
        assertEquals(351, counter(id, "cycle_count"));
        service.favorite("paused", id, true);
        service.update(id, save(3, List.of(1L), null));
        assertEquals(8, card(id).score());
        assertEquals(351, counter(id, "cycle_count"));
        service.favorite("paused", id, false);
        service.favorite("paused", id, true);
        assertEquals(351, counter(id, "cycle_count"));
        service.favorite("unseen", id, true);
        assertEquals(10, card(id).score());
        assertEquals(152, counter(id, "cycle_count"));
        service.update(id, save(4, List.of(1L), null));
        service.favorite("still-capped", id, true);
        assertEquals(152, counter(id, "cycle_count"));
    }
    @Test void editPreservesIdentityCreationFavoritesAndRewardWhileClearingEvaluation() {
        final long id = create(3, List.of(1L, 2L), 1L).id();
        service.favorite("a", id, true);
        final var before = card(id);
        final CreatorDtos.Detail changed = service.update(id, new CreatorDtos.SaveRequest("Changed", "  Details  ",
                "https://space.bilibili.com/456/?spm_id_from=tracker", List.of(2L), null, 2, null));
        assertEquals(id, changed.id());
        assertEquals("https://space.bilibili.com/456", changed.homepageUrl());
        assertEquals("Details", changed.description());
        assertEquals(before.createdAt(), card(id).createdAt());
        assertEquals(1, card(id).favoriteCount());
        assertEquals(1, counter(id, "cycle_count"));
        assertEquals(null, card(id).level());
        assertEquals(List.of(id), service.favorites("a").creatorIds());
        service.deleteLevel(1);
    }
    @Test void categoryDeletionBlocksAtomicallyAndConcurrentDeletesCannotOrphanCreators() throws Exception {
        final long id = create(3, List.of(1L, 2L), null).id();
        final List<Boolean> results = race(() -> attempt(() -> service.deleteCategory(1)), () -> attempt(() -> service.deleteCategory(2)));
        assertEquals(1, results.stream().filter(Boolean::booleanValue).count());
        assertEquals(1, card(id).categories().size());
        final long remaining = card(id).categories().getFirst().id();
        assertCode(ApiErrorCode.CREATOR_CATEGORY_IN_USE, () -> service.deleteCategory(remaining));
        assertEquals(1, card(id).categories().size());
    }
    @Test void categoryEditAndLevelDeletionRacesNeverLeaveInvalidReferences() throws Exception {
        final long id = create(3, List.of(1L), null).id();
        race(() -> attempt(() -> service.update(id, save(3, List.of(2L), null))),
                () -> attempt(() -> service.deleteCategory(2)));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from creator c where not exists (
                    select 1 from creator_category_link l join creator_category d on d.id=l.category_id where l.creator_id=c.id)
                """, Integer.class));
        race(() -> attempt(() -> service.update(id, save(3, service.detail(id).categoryIds(), 1L))),
                () -> attempt(() -> service.deleteLevel(1)));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from creator c where level_id is not null
                    and not exists (select 1 from creator_level l where l.id=c.level_id)
                """, Integer.class));
    }
    @Test void levelReferencesAndInvalidSaveRollbackAllChanges() {
        final long id = create(3, List.of(1L), 1L).id();
        assertCode(ApiErrorCode.CREATOR_LEVEL_IN_USE, () -> service.deleteLevel(1));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT, () -> service.update(id, save(1, List.of(999L), null)));
        assertEquals(3, service.detail(id).baseStars());
        assertEquals(1L, service.detail(id).levelId());
        assertEquals(List.of(1L), service.detail(id).categoryIds());
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(save(0, List.of(1L), null)));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(save(3, List.of(), null)));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(save(3, List.of(1L, 1L), null)));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.configure(new CreatorDtos.SettingsRequest(0)));
        assertCode(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND, () -> service.create(new CreatorDtos.SaveRequest("N", null,
                "https://space.bilibili.com/123", List.of(1L), null, 3, "pending-avatar")));
        assertEquals(1, creators.count());
    }
    @Test void strictHomepageValidationAndDictionaryInputsHaveNoSideEffects() {
        for (final String url : List.of("javascript:alert(1)", "http://space.bilibili.com/123", "https://space.bilibili.com.evil/123",
                "https://space.bilibili.com@evil/123", "https://space.bilibili.com:443/123", "https://space.bilibili.com/0",
                "https://space.bilibili.com/123/video", "https://space.bilibili.com/%31%32%33")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(new CreatorDtos.SaveRequest("N", null, url, List.of(1L), null, 3, null)));
        }
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addCategory(new CreatorDtos.DictionaryRequest(" ")));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addLevel(new CreatorDtos.DictionaryRequest("x".repeat(101))));
        assertEquals(0, creators.count());
    }
    @Test void removalRacingFavoriteCleansOnlyThatCreatorAndPreservesDictionaries() throws Exception {
        final long removed = create(3, List.of(1L), 1L).id();
        final long retained = create(3, List.of(1L), 1L).id();
        service.favorite("same", retained, true);
        race(() -> attempt(() -> service.favorite("same", removed, true)), () -> attempt(() -> service.delete(removed)));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.detail(removed));
        assertEquals(List.of(retained), service.favorites("same").creatorIds());
        assertEquals(1, card(retained).favoriteCount());
        assertEquals(3, service.categories().size());
        assertEquals(2, service.levels().size());
    }
    @Test void sortingUsesCappedScoreThenOriginalCreationTimeAndDistinctCategoryMembership() {
        final long older = create(5, List.of(1L, 2L), null).id();
        final long newer = create(5, List.of(1L), null).id();
        jdbc.update("update creator set created_at='2026-10-15T00:00:00Z', reward_points=8, favorite_count=900 where id=?", older);
        jdbc.update("update creator set created_at='2026-10-16T00:00:00Z' where id=?", newer);
        assertEquals(List.of(newer, older), service.list(1L).stream().map(CreatorDtos.Card::id).toList());
        service.update(older, save(5, List.of(1L, 2L), null));
        assertEquals(List.of(newer, older), service.list(1L).stream().map(CreatorDtos.Card::id).toList());
        assertEquals(2, service.list(null).size());
    }
    @Test void differentCreatorsCanFavoriteWhileAnotherCreatorIsRowLocked() throws Exception {
        final long blocked = create(3, List.of(1L), null).id();
        final long free = create(3, List.of(1L), null).id();
        final CountDownLatch held = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var lock = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                settings.findShared();
                creators.findLocked(blocked).orElseThrow();
                held.countDown();
                try { assertTrue(release.await(10, TimeUnit.SECONDS)); }
                catch (final InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            }));
            assertTrue(held.await(10, TimeUnit.SECONDS));
            try {
                assertEquals(1, executor.submit(() -> service.favorite("free", free, true)).get(5, TimeUnit.SECONDS).creator().favoriteCount());
            } finally { release.countDown(); }
            lock.get(10, TimeUnit.SECONDS);
        }
    }
    @Test void accountCleanupRemovesActiveAndInactiveHistoryWithoutReversingRewardsOrOtherUsers() {
        service.configure(new CreatorDtos.SettingsRequest(2));
        final long first = create(3, List.of(1L), 1L).id();
        final long second = create(3, List.of(1L), 1L).id();
        final long third = create(3, List.of(1L), null).id();
        service.favorite("deleted", first, true);
        service.favorite("other", first, true);
        service.favorite("deleted", second, true);
        service.favorite("deleted", second, false);
        service.favorite("other", second, true);
        service.favorite("deleted", third, true);

        service.removeDataForAccountDeletion("deleted");
        service.removeDataForAccountDeletion("deleted");

        assertEquals(0, jdbc.queryForObject("select count(*) from creator_favorite where keycloak_subject='deleted'", Integer.class));
        assertEquals(List.of(first, second), service.favorites("other").creatorIds());
        assertEquals(1, card(first).favoriteCount());
        assertEquals(1, card(second).favoriteCount());
        assertEquals(0, card(third).favoriteCount());
        assertEquals(1, counter(first, "reward_points"));
        assertEquals(1, counter(second, "reward_points"));
        assertEquals(1, counter(third, "cycle_count"));
        assertEquals(3, service.list(null).size());
        assertEquals(3, service.categories().size());
        assertEquals(2, service.levels().size());
    }
    @Test void accountCleanupWaitsForInFlightFirstFavoriteBeforeScanningHistory() throws Exception {
        final long id = create(3, List.of(1L), null).id();
        final CountDownLatch favoriteHeld = new CountDownLatch(1);
        final CountDownLatch releaseFavorite = new CountDownLatch(1);
        final CountDownLatch cleanupStarted = new CountDownLatch(1);
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var favorite = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                settings.findShared();
                favoriteHeld.countDown();
                try { assertTrue(releaseFavorite.await(10, TimeUnit.SECONDS)); }
                catch (final InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                service.favorite("deleted", id, true);
            }));
            assertTrue(favoriteHeld.await(10, TimeUnit.SECONDS));
            final var cleanup = executor.submit(() -> {
                cleanupStarted.countDown();
                service.removeDataForAccountDeletion("deleted");
            });
            assertTrue(cleanupStarted.await(10, TimeUnit.SECONDS));
            try {
                assertThrows(TimeoutException.class, () -> cleanup.get(300, TimeUnit.MILLISECONDS));
            } finally { releaseFavorite.countDown(); }
            favorite.get(10, TimeUnit.SECONDS);
            cleanup.get(10, TimeUnit.SECONDS);
        }
        assertEquals(0, card(id).favoriteCount());
        assertEquals(1, counter(id, "cycle_count"));
        assertEquals(0, jdbc.queryForObject("select count(*) from creator_favorite where keycloak_subject='deleted'", Integer.class));
    }
    @Test void adminDeletionCleansFavoritesForAccountsWithAndWithoutLocalProfile() {
        final long id = create(3, List.of(1L), null).id();
        jdbc.update("insert into user_profile(keycloak_user_id, created_at, updated_at) values ('with-profile', now(), now())");
        service.favorite("with-profile", id, true);
        service.favorite("jwt-only", id, true);
        service.favorite("other", id, true);

        final var result = adminUsers.deleteUsers(List.of("with-profile", "jwt-only"), true, adminJwt());

        assertEquals(2, result.deleted());
        assertEquals(0, result.failed());
        assertEquals(0, jdbc.queryForObject("select count(*) from user_profile", Integer.class));
        assertEquals(List.of("other"), jdbc.queryForList("select keycloak_subject from creator_favorite", String.class));
        assertEquals(1, card(id).favoriteCount());
        assertEquals(3, counter(id, "cycle_count"));
        assertEquals(2, jdbc.queryForObject("select count(*) from admin_user_log where status='SUCCESS'", Integer.class));
        verify(keycloakUsers).deleteUser("with-profile");
        verify(keycloakUsers).deleteUser("jwt-only");
    }
    @Test void keycloakFailureRollsBackFavoriteCleanupAndProfileDeletionButKeepsAudit() {
        final long id = create(3, List.of(1L), null).id();
        jdbc.update("insert into user_profile(keycloak_user_id, created_at, updated_at) values ('failed', now(), now())");
        service.favorite("failed", id, true);
        doThrow(new IllegalStateException("keycloak unavailable")).when(keycloakUsers).deleteUser("failed");

        final var result = adminUsers.deleteUsers(List.of("failed"), true, adminJwt());

        assertEquals("FAILED_KEYCLOAK_DELETE", result.results().getFirst().errorCode());
        assertEquals(1, jdbc.queryForObject("select count(*) from user_profile where keycloak_user_id='failed'", Integer.class));
        assertEquals(List.of(id), service.favorites("failed").creatorIds());
        assertEquals(1, card(id).favoriteCount());
        assertEquals(1, counter(id, "cycle_count"));
        assertEquals("FAILED_KEYCLOAK_DELETE", jdbc.queryForObject("select status from admin_user_log", String.class));
    }
    @Test void localProfileFailureRollsBackFavoriteCleanupBeforeCallingKeycloak() {
        final long id = create(3, List.of(1L), null).id();
        jdbc.update("insert into user_profile(keycloak_user_id, created_at, updated_at) values ('dependent', now(), now())");
        jdbc.execute("create table account_cleanup_test_dependency(profile_id bigint references user_profile(id))");
        try {
            jdbc.update("insert into account_cleanup_test_dependency select id from user_profile where keycloak_user_id='dependent'");
            service.favorite("dependent", id, true);

            final var result = adminUsers.deleteUsers(List.of("dependent"), true, adminJwt());

            assertEquals("USER_HAS_DEPENDENCIES", result.results().getFirst().errorCode());
            assertEquals(List.of(id), service.favorites("dependent").creatorIds());
            assertEquals(1, card(id).favoriteCount());
            assertEquals(1, counter(id, "cycle_count"));
            org.mockito.Mockito.verifyNoInteractions(keycloakUsers);
            assertEquals("FAILED_LOCAL_DELETE", jdbc.queryForObject("select status from admin_user_log", String.class));
        } finally { jdbc.execute("drop table account_cleanup_test_dependency"); }
    }
    private static Jwt adminJwt() {
        return Jwt.withTokenValue("token").header("alg", "none").subject("admin").claim("preferred_username", "admin").build();
    }
    private CreatorDtos.Detail create(final int stars, final List<Long> ids, final Long levelId) {
        return service.create(save(stars, ids, levelId));
    }
    private static CreatorDtos.SaveRequest save(final int stars, final List<Long> ids, final Long levelId) {
        return new CreatorDtos.SaveRequest("Creator", null, "https://space.bilibili.com/123", ids, levelId, stars, null);
    }
    private CreatorDtos.Card card(final long id) {
        return service.list(null).stream().filter(creator -> creator.id() == id).findFirst().orElseThrow();
    }
    private long counter(final long id, final String column) {
        if (!List.of("cycle_count", "reward_points").contains(column)) { throw new IllegalArgumentException("Test column"); }
        return jdbc.queryForObject("select " + column + " from creator where id=?", Long.class, id);
    }
    private static void assertCode(final ApiErrorCode code, final Runnable operation) {
        assertEquals(code, assertThrows(ApiException.class, operation::run).errorCode());
    }
    private static boolean attempt(final Runnable operation) {
        try { operation.run(); return true; }
        catch (final ApiException e) { return false; }
    }
    private static <T> List<T> race(final Callable<T> first, final Callable<T> second) throws Exception {
        final CountDownLatch start = new CountDownLatch(1);
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var a = executor.submit(() -> { assertTrue(start.await(10, TimeUnit.SECONDS)); return first.call(); });
            final var b = executor.submit(() -> { assertTrue(start.await(10, TimeUnit.SECONDS)); return second.call(); });
            start.countDown();
            return List.of(a.get(20, TimeUnit.SECONDS), b.get(20, TimeUnit.SECONDS));
        }
    }
}
