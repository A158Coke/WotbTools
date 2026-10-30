package com.wotb.web.creator;

import com.wotb.web.creator.dto.RecommendationDtos;
import org.springframework.http.HttpMethod;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real PostgreSQL proves UID uniqueness, catalog write serialization and dictionary references. */
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
        registry.add("wotb.broadcast.cos.bucket", () -> "");
        registry.add("wotb.tournament.recognition-signing-key", () -> "integration-only-32-byte-signing-secret");
    }

    @Autowired CreatorService service;
    @Autowired CreatorRepository creators;
    @Autowired JdbcTemplate jdbc;
    @Autowired WebApplicationContext web;
    @Autowired PlatformTransactionManager transactions;
    private long nextUid;

    @Test void catalogLockRequiresAnExistingTransaction() {
        assertThrows(IllegalTransactionStateException.class, creators::lockCatalog);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void catalogLockIsExclusiveAcrossConnectionsAndReleasedAtTransactionEnd(final boolean rollback) {
        // A separate physical connection observes the lock while the real repository joins the JPA transaction.
        final JdbcTemplate observer = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            creators.lockCatalog();
            assertFalse(observer.queryForObject("select pg_try_advisory_xact_lock(1464816706, 1)", Boolean.class));
            jdbc.update("insert into creator_category(name) values ('Transaction probe')");
            if (rollback) { tx.setRollbackOnly(); }
        });
        assertTrue(observer.queryForObject("select pg_try_advisory_xact_lock(1464816706, 1)", Boolean.class));
        assertEquals(rollback ? 0 : 1, jdbc.queryForObject(
                "select count(*) from creator_category where name='Transaction probe'", Integer.class));
    }

    @Test void v35UpgradeDropsOnlyTheLockTableAndPreservesDirectoryData() {
        jdbc.execute("create database creator_lock_upgrade");
        final String url = POSTGRES.getJdbcUrl().replace("/wotb", "/creator_lock_upgrade");
        final JdbcTemplate upgrade = new JdbcTemplate(new DriverManagerDataSource(
                url, POSTGRES.getUsername(), POSTGRES.getPassword()));
        try {
            Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).target("35").load().migrate();
            assertEquals(1, upgrade.queryForObject("select count(*) from creator_catalog_lock", Integer.class));
            upgrade.update("update creator_category set name='Custom category' where id=1");
            upgrade.update("insert into creator_avatar(id,object_key,status,content_type,size,hash,created_at) "
                    + "values ('11111111-1111-4111-8111-111111111111','creator-avatars/test','READY','image/png',1,?,now())", "a".repeat(64));
            upgrade.update("insert into creator(bilibili_uid,name,version,stars,level_id,avatar_id,created_at) "
                    + "values ('123','Preserved creator',7,4,1,'11111111-1111-4111-8111-111111111111',now())");
            upgrade.update("insert into creator_category_link(creator_id,category_id) values (1,1)");
            final String query = "select c.*, a.object_key, a.hash, cat.name as category_name, l.name as level_name "
                    + "from creator c join creator_avatar a on a.id=c.avatar_id "
                    + "join creator_category_link link on link.creator_id=c.id "
                    + "join creator_category cat on cat.id=link.category_id join creator_level l on l.id=c.level_id";
            final var before = upgrade.queryForMap(query);
            final Flyway flyway = Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).target("36").load();
            flyway.migrate(); flyway.validate();
            assertNull(upgrade.queryForObject("select to_regclass('creator_catalog_lock')::text", String.class));
            assertEquals(before, upgrade.queryForMap(query));
            assertEquals(6, upgrade.queryForObject("select count(*) from creator_category", Integer.class));
            assertEquals(4, upgrade.queryForObject("select count(*) from creator_level", Integer.class));
        } finally {
            jdbc.execute("drop database creator_lock_upgrade with (force)");
        }
    }

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
        jdbc.execute("truncate creator, creator_avatar, creator_category, creator_level restart identity cascade");
        jdbc.update("insert into creator_category(name) values ('A'),('B'),('C')");
        jdbc.update("insert into creator_level(name) values ('Basic'),('Expert')");
        nextUid = 1000;
    }

    @Test void schemaContainsOnlySiteDirectoryTablesAndEnforcesUidAndStarConstraints() {
        assertEquals(List.of("creator", "creator_avatar", "creator_category", "creator_category_link", "creator_level"),
                jdbc.queryForList("select tablename from pg_tables where schemaname='public' and tablename like 'creator%' order by tablename", String.class));
        assertFalse(service.recommendationMetadata("UP").imageUploadsAvailable());
        final Long id = jdbc.queryForObject(
                "insert into creator(bilibili_uid,name,created_at) values ('900001','Default',now()) returning id", Long.class);
        jdbc.update("insert into creator_category_link(creator_id,category_id) values (?,1)", id);
        assertEquals(3, jdbc.queryForObject("select stars from creator where id=?", Integer.class, id));
        assertEquals(0L, jdbc.queryForObject("select version from creator where id=?", Long.class, id));
        assertEquals(6, card(id).score());
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set stars=0 where id=?", id));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set stars=6 where id=?", id));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("update creator set version=-1 where id=?", id));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("insert into creator(bilibili_uid,name,created_at) values ('900001','Duplicate',now())"));
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("insert into creator(bilibili_uid,name,created_at) values ('00012','Unnormalized',now())"));
    }

    @Test void createNormalizesUidAndProjectsHomepageAndManualStarsWithoutAnAvatar() {
        final RecommendationDtos.Detail detail = service.createRecommendation(
                new RecommendationDtos.SaveRequest("UP", " 000123 ", " Creator ", " Description ", List.of(2L, 1L), 1L, 3, "KEEP", null), null);
        assertEquals("123", detail.externalId());
        assertEquals("Creator", detail.name());
        assertEquals("Description", detail.description());
        assertEquals(List.of(1L, 2L), detail.categoryIds());
        assertEquals(3, detail.stars());
        assertEquals(0L, detail.version());
        assertNull(detail.imageUrl());
        final RecommendationDtos.Card card = card(detail.id());
        assertEquals(detail.version(), card.version());
        assertEquals("123", card.externalId());
        assertEquals("https://space.bilibili.com/123", card.targetUrl());
        assertEquals(6, card.score());
        assertEquals(2, card.categories().size());
        assertEquals("Basic", card.level().name());
        assertEquals(detail.id(), service.recommendations("UP", 2L).getFirst().id());
        assertEquals(1, service.recommendations("UP", null).size());
        assertEquals(List.of(), service.recommendations("UP", 999L));
    }

    @Test void twentyDigitUidRemainsAnExactString() {
        final String uid = "12345678901234567890";
        final RecommendationDtos.Detail detail = service.createRecommendation(save(uid, 5, List.of(1L), null, null), null);
        assertEquals(uid, detail.externalId());
        assertEquals(uid, service.recommendationDetail("UP", detail.id()).externalId());
        assertEquals("https://space.bilibili.com/" + uid, card(detail.id()).targetUrl());
        assertEquals(10, card(detail.id()).score());
    }

    @Test void publicCategoriesFollowCommittedMembershipWhileMetadataKeepsEmptyCategories() {
        final List<RecommendationDtos.Category> dictionary = List.of(new RecommendationDtos.Category(1, "A", "UP"),
                new RecommendationDtos.Category(2, "B", "UP"), new RecommendationDtos.Category(3, "C", "UP"));
        assertEquals(List.of(), service.publicRecommendationCategories());
        assertEquals(dictionary, service.recommendationMetadata("UP").categories());

        final RecommendationDtos.Detail first = create(3, List.of(2L), null);
        assertEquals(List.of(dictionary.get(1)), service.publicRecommendationCategories());
        final RecommendationDtos.Detail second = create(3, List.of(3L, 2L), null);
        assertEquals(List.of(dictionary.get(1), dictionary.get(2)), service.publicRecommendationCategories());
        assertEquals(List.of(dictionary.get(1), dictionary.get(2)), card(second.id()).categories());
        assertEquals(dictionary, service.recommendationMetadata("UP").categories());

        final RecommendationDtos.Detail moved = service.updateRecommendation(second.id(),
                save(second.externalId(), 3, List.of(1L), null, second.version()), null);
        assertEquals(List.of(dictionary.get(0), dictionary.get(1)), service.publicRecommendationCategories());
        assertEquals(List.of(dictionary.get(0)), card(moved.id()).categories());
        service.deleteRecommendation("UP", first.id(), first.version());
        assertEquals(List.of(dictionary.get(0)), service.publicRecommendationCategories());
        service.deleteRecommendation("UP", moved.id(), moved.version());
        assertEquals(List.of(), service.publicRecommendationCategories());
        assertEquals(dictionary, service.recommendationMetadata("UP").categories());
    }

    @Test void publicCategoryHttpResponseIsTheSameForEveryRoleWhileAdminMetadataRemainsComplete() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        mvc.perform(get("/api/recommendations/categories")).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        create(3, List.of(2L), null);
        mvc.perform(get("/api/recommendations/categories")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].id").value(2));
        for (final String role : List.of("wotbtools-user", "HoF-admin", "wotbtools-admin", "tournament-admin", "content-admin")) {
            mvc.perform(get("/api/recommendations/categories").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                    .andExpect(jsonPath("$[0].id").value(2)).andExpect(jsonPath("$[0].name").value("B"));
        }
        mvc.perform(get("/api/admin/recommendations/metadata?type=UP")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/recommendations/metadata?type=UP").with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/recommendations/metadata?type=UP")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.categories.length()").value(3))
                .andExpect(jsonPath("$.categories[0].name").value("A"))
                .andExpect(jsonPath("$.categories[2].name").value("C"));
    }

    @Test void concurrentEquivalentUidsProduceOneCreatorAndOneCanonicalConflict() throws Exception {
        final List<String> results = race(
                () -> outcome(() -> service.createRecommendation(save("00123", 3, List.of(1L), null, null), null)),
                () -> outcome(() -> service.createRecommendation(save("123", 4, List.of(2L), null, null), null)));
        assertEquals(1, results.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, results.stream().filter(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS.name()::equals).count());
        assertEquals(1, creators.count());
        assertEquals("123", service.recommendations("UP", null).getFirst().externalId());
    }

    @Test void duplicateUidUpdateRollsBackAllEditableFields() {
        final RecommendationDtos.Detail first = service.createRecommendation(save("123", 3, List.of(1L), 1L, null), null);
        final RecommendationDtos.Detail second = service.createRecommendation(save("456", 2, List.of(2L), null, null), null);
        assertCode(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS,
                () -> service.updateRecommendation(second.id(), save("000123", 5, List.of(3L), 2L, second.version()), null));
        assertEquals(second, service.recommendationDetail("UP", second.id()));
        assertEquals(first, service.recommendationDetail("UP", first.id()));
        assertEquals(2, creators.count());
    }

    @Test void editsKeepIdentityAndCreationTimeWhileReplacingAllAdministratorFields() {
        final RecommendationDtos.Detail created = service.createRecommendation(save("123", 3, List.of(1L), 1L, null), null);
        final var createdAt = card(created.id()).createdAt();
        final RecommendationDtos.Detail updated = service.updateRecommendation(created.id(),
                new RecommendationDtos.SaveRequest("UP", "000456", " Renamed ", null, List.of(2L, 3L), null, 5, "REMOVE", created.version()), null);
        assertEquals(created.id(), updated.id());
        assertEquals(created.version() + 1, updated.version());
        assertEquals(createdAt, card(created.id()).createdAt());
        assertEquals("456", updated.externalId());
        assertEquals("Renamed", updated.name());
        assertNull(updated.description());
        assertNull(updated.levelId());
        assertNull(updated.imageUrl());
        assertEquals(List.of(2L, 3L), updated.categoryIds());
        assertEquals(10, card(created.id()).score());
        assertNull(card(created.id()).level());
        assertEquals("https://space.bilibili.com/456", card(created.id()).targetUrl());
        final RecommendationDtos.Detail repeated = service.updateRecommendation(created.id(), new RecommendationDtos.SaveRequest("UP", "456", "Renamed", null,
                List.of(2L, 3L), null, 5, "KEEP", updated.version()), null);
        assertEquals(updated.version() + 1, repeated.version());
        assertEquals(updated.externalId(), repeated.externalId());
        assertEquals(updated.categoryIds(), repeated.categoryIds());
        assertEquals("123", service.createRecommendation(save("123", 3, List.of(1L), null, null), null).externalId());
    }

    @Test void sortingUsesManualStarsThenOriginalCreationTimeAndStableId() {
        final long older = create(5, List.of(1L, 2L), null).id();
        final long newer = create(5, List.of(1L), null).id();
        final long lower = create(4, List.of(1L), null).id();
        jdbc.update("update creator set created_at='2026-10-15T00:00:00Z' where id=?", older);
        jdbc.update("update creator set created_at='2026-10-16T00:00:00Z' where id in (?,?)", newer, lower);
        assertEquals(List.of(newer, older, lower), service.recommendations("UP", 1L).stream().map(RecommendationDtos.Card::id).toList());
        jdbc.update("update creator set created_at='2026-10-16T00:00:00Z' where id=?", older);
        assertEquals(List.of(newer, older, lower), service.recommendations("UP", null).stream().map(RecommendationDtos.Card::id).toList());
        assertEquals(3, service.recommendations("UP", null).size());
        assertEquals(2, card(older).categories().size());
    }

    @Test void concurrentCategoryDeletesCannotLeaveACreatorWithoutAnyCategory() throws Exception {
        final long id = create(3, List.of(1L, 2L), null).id();
        final List<String> results = race(
                () -> outcome(() -> service.deleteRecommendationCategory("UP", 1)),
                () -> outcome(() -> service.deleteRecommendationCategory("UP", 2)));
        assertEquals(1, results.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, results.stream().filter(ApiErrorCode.CREATOR_CATEGORY_IN_USE.name()::equals).count());
        final long remaining = card(id).categories().getFirst().id();
        assertEquals(1, card(id).categories().size());
        assertEquals(1, card(id).version());
        assertCode(ApiErrorCode.CREATOR_CATEGORY_IN_USE, () -> service.deleteRecommendationCategory("UP", remaining));
        assertEquals(2, service.recommendationMetadata("UP").categories().size());
    }

    @Test void categoryEditsAndLevelDeletesSerializeWithoutInvalidReferences() throws Exception {
        final long categoryCreator = create(3, List.of(1L, 2L), null).id();
        race(() -> outcome(() -> service.updateRecommendation(categoryCreator,
                        save(service.recommendationDetail("UP", categoryCreator).externalId(), 3, List.of(2L), null, 0L), null)),
                () -> outcome(() -> service.deleteRecommendationCategory("UP", 2)));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from creator c where not exists
                (select 1 from creator_category_link l where l.creator_id=c.id)
                """, Integer.class));
        final long levelCreator = create(3, List.of(1L), null).id();
        final String uid = service.recommendationDetail("UP", levelCreator).externalId();
        race(() -> outcome(() -> service.updateRecommendation(levelCreator, save(uid, 3, List.of(1L), 2L, 0L), null)),
                () -> outcome(() -> service.deleteLevel(2)));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from creator c where c.level_id is not null and not exists
                (select 1 from creator_level l where l.id=c.level_id)
                """, Integer.class));
    }

    @Test void dictionaryMaintenanceHonorsReferenceProtectionAndSupportsDisablingAssessment() {
        final long id = create(3, List.of(1L), 1L).id();
        assertCode(ApiErrorCode.CREATOR_LEVEL_IN_USE, () -> service.deleteLevel(1));
        final RecommendationDtos.Category category = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("UP", " New category "));
        final RecommendationDtos.Level level = service.addLevel(new RecommendationDtos.DictionaryRequest(" New level "));
        assertEquals("New category", category.name());
        assertEquals("New level", level.name());
        service.deleteRecommendationCategory("UP", category.id());
        service.deleteLevel(level.id());
        service.updateRecommendation(id, save(service.recommendationDetail("UP", id).externalId(), 3, List.of(1L), null, service.recommendationDetail("UP", id).version()), null);
        service.deleteLevel(1);
        assertNull(card(id).level());
        assertEquals(1, service.recommendationMetadata("UP").levels().size());
    }

    @Test void invalidDirectoryInputsLeaveExistingRecordsUnchanged() {
        final RecommendationDtos.Detail original = create(3, List.of(1L), 1L);
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(null, null));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.updateRecommendation(original.id(), save(original.externalId(), 1, List.of(999L), null, original.version()), null));
        assertEquals(original, service.recommendationDetail("UP", original.id()));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.createRecommendation(save("999", 3, List.of(1L), 999L, null), null));
        for (final String uid : Arrays.asList(null, "", " ", "0", "0000", "-1", "+1", "1.5",
                "1e3", "１２３", "https://space.bilibili.com/123", "123456789012345678901")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.createRecommendation(save(uid, 3, List.of(1L), null, null), null));
        }
        for (final int stars : new int[] {0, 6}) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.createRecommendation(save("999", stars, List.of(1L), null, null), null));
        }
        for (final List<Long> ids : Arrays.<List<Long>>asList(null, List.of(), List.of(1L, 1L), List.of(0L), Arrays.asList(1L, null))) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.createRecommendation(save("999", 3, ids, null, null), null));
        }
        for (final String name : Arrays.asList(null, "", " ", "x".repeat(101))) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.createRecommendation(new RecommendationDtos.SaveRequest("UP", "999", name, null, List.of(1L), null, 3, "KEEP", null), null));
        }
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.createRecommendation(save("999", 3, List.of(1L), 0L, null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.createRecommendation(new RecommendationDtos.SaveRequest("UP", "999", "N", "x".repeat(2001), List.of(1L), null, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("UP", " ")));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addLevel(new RecommendationDtos.DictionaryRequest("x".repeat(101))));
        assertEquals(1, creators.count());
    }

    @Test void imageActionAndFilePresenceMustAgreeBeforeAnyDirectoryWrite() {
        final MockMultipartFile file = new MockMultipartFile("image", "image.png", "image/png", new byte[] {1});
        for (final String action : Arrays.asList(null, "", "keep", "UNKNOWN", "REPLACE")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(
                    new RecommendationDtos.SaveRequest("UP", "999", "N", null, List.of(1L), null, 3, action, null), null));
        }
        for (final String action : List.of("KEEP", "REMOVE")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(
                    new RecommendationDtos.SaveRequest("UP", "999", "N", null, List.of(1L), null, 3, action, null), file));
        }
        assertEquals(0, creators.count());
        assertEquals(0, jdbc.queryForObject("select count(*) from creator_avatar", Integer.class));
        assertNull(service.createRecommendation(save("999", 3, List.of(1L), null, null), null).imageUrl());
    }

    @Test void removalOnlyDeletesItsCreatorAndCategoryCompositionAndReleasesTheUid() {
        final RecommendationDtos.Detail removed = service.createRecommendation(save("123", 3, List.of(1L, 2L), 1L, null), null);
        final RecommendationDtos.Detail retained = service.createRecommendation(save("456", 3, List.of(2L), 2L, null), null);
        service.deleteRecommendation("UP", removed.id(), removed.version());
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.recommendationDetail("UP", removed.id()));
        assertEquals(retained, service.recommendationDetail("UP", retained.id()));
        assertEquals(1, jdbc.queryForObject("select count(*) from creator_category_link", Integer.class));
        assertEquals(3, service.recommendationMetadata("UP").categories().size());
        assertEquals(2, service.recommendationMetadata("UP").levels().size());
        assertEquals("123", service.createRecommendation(save("123", 3, List.of(1L), null, null), null).externalId());
    }

    @Test void uidWhitespaceMatchesEcmascriptThroughMultipartAndPersistence() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        final var json = JsonMapper.builder().findAndAddModules().build();
        final var admin = jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin"));
        final int[] whitespace = {9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
                8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279};
        for (final int codePoint : whitespace) {
            final String padding = Character.toString(codePoint), uid = Integer.toString(600000 + codePoint);
            final RecommendationDtos.SaveRequest valid = save(padding + "000" + uid + padding, 3, List.of(1L), null, null);
            mvc.perform(multipart("/api/admin/recommendations").file(new MockMultipartFile("payload", "", "application/json", json.writeValueAsBytes(valid))).with(admin))
                    .andExpect(status().isCreated()).andExpect(jsonPath("$.externalId").value(uid));
            assertTrue(creators.existsByTypeAndExternalId("UP", uid));
            for (final String invalid : List.of(padding + "000" + padding, "12" + padding + "3")) {
                mvc.perform(multipart("/api/admin/recommendations").file(new MockMultipartFile("payload", "", "application/json",
                                json.writeValueAsBytes(save(invalid, 3, List.of(1L), null, null)))).with(admin))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("CREATOR_INVALID_REQUEST"));
            }
        }
        // Java trim/strip or UNICODE_CHARACTER_CLASS must not broaden the wire contract.
        for (final int codePoint : new int[] {0, 8, 14, 28, 31, 133, 6158, 8191, 8203, 8234, 8288, 8289, 12289}) {
            final String padding = Character.toString(codePoint);
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.createRecommendation(save(padding + "123" + padding, 3, List.of(1L), null, null), null));
        }
        assertEquals(whitespace.length, creators.count());
    }

    @Test void unicodeLimitsCountCodePointsForCreatorAndDictionaryNamesAndDescription() {
        final String name = "😀".repeat(100);
        final String description = "🚀".repeat(2000);
        final RecommendationDtos.Detail created = service.createRecommendation(new RecommendationDtos.SaveRequest("UP", "300001", " " + name + " ",
                description, List.of(1L), null, 3, "KEEP", null), null);
        assertEquals(name, created.name());
        assertEquals(description, created.description());
        assertEquals(100, jdbc.queryForObject("select length(name) from creator where id=?", Integer.class, created.id()));
        assertEquals(2000, jdbc.queryForObject("select length(description) from creator where id=?", Integer.class, created.id()));
        assertEquals(name, service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("UP", " " + name + " ")).name());
        assertEquals(name, service.addLevel(new RecommendationDtos.DictionaryRequest(" " + name + " ")).name());
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(new RecommendationDtos.SaveRequest("UP", "300002", name + "😀",
                null, List.of(1L), null, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(new RecommendationDtos.SaveRequest("UP", "300003", name,
                description + "🚀", List.of(1L), null, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("UP", name + "😀")));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addLevel(new RecommendationDtos.DictionaryRequest(name + "😀")));
        assertEquals(1, creators.count());
    }

    @Test void unicodeLimitsSurviveRealMultipartBindingAndPostgresqlPersistence() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        final var json = JsonMapper.builder().findAndAddModules().build();
        final var admin = jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin"));
        final String name = "😀".repeat(100), description = "🚀".repeat(2000);
        final RecommendationDtos.SaveRequest valid = new RecommendationDtos.SaveRequest("UP", "300001", name, description, List.of(1L), null, 3, "KEEP", null);
        mvc.perform(multipart("/api/admin/recommendations").file(new MockMultipartFile("payload", "", "application/json", json.writeValueAsBytes(valid))).with(admin))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value(name))
                .andExpect(jsonPath("$.description").value(description)).andExpect(jsonPath("$.version").value(0));
        for (final RecommendationDtos.SaveRequest invalid : List.of(
                new RecommendationDtos.SaveRequest("UP", "300002", name + "😀", null, List.of(1L), null, 3, "KEEP", null),
                new RecommendationDtos.SaveRequest("UP", "300003", name, description + "🚀", List.of(1L), null, 3, "KEEP", null))) {
            mvc.perform(multipart("/api/admin/recommendations").file(new MockMultipartFile("payload", "", "application/json", json.writeValueAsBytes(invalid))).with(admin))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("CREATOR_INVALID_REQUEST"));
        }
        for (final String dictionary : List.of("categories", "levels")) {
            mvc.perform(post("/api/admin/recommendations/" + dictionary).contentType("application/json")
                            .content(json.writeValueAsBytes("categories".equals(dictionary) ? new RecommendationDtos.CategoryRequest("UP", name) : new RecommendationDtos.DictionaryRequest(name))).with(admin))
                    .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value(name));
            mvc.perform(post("/api/admin/recommendations/" + dictionary).contentType("application/json")
                            .content(json.writeValueAsBytes("categories".equals(dictionary) ? new RecommendationDtos.CategoryRequest("UP", name + "😀") : new RecommendationDtos.DictionaryRequest(name + "😀"))).with(admin))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("CREATOR_INVALID_REQUEST"));
        }
        assertEquals(1, creators.count());
        assertEquals(description, service.recommendations("UP", null).getFirst().description());
    }

    @Test void operationVersionsRejectInvalidRequestsAndStaleUpdateOrRemoval() {
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.createRecommendation(save("123", 3, List.of(1L), null, 0L), null));
        final RecommendationDtos.Detail original = service.createRecommendation(save("123", 3, List.of(1L), null, null), null);
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.updateRecommendation(original.id(), save("123", 4, List.of(1L), null, null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.updateRecommendation(original.id(), save("123", 4, List.of(1L), null, -1L), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.deleteRecommendation("UP", original.id(), -1));
        final RecommendationDtos.Detail changed = service.updateRecommendation(original.id(), save("123", 4, List.of(2L), null, original.version()), null);
        assertEquals(1, changed.version());
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.updateRecommendation(original.id(), save("456", 1, List.of(3L), null, original.version()), null));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT, () -> service.deleteRecommendation("UP", original.id(), original.version()));
        assertEquals(changed, service.recommendationDetail("UP", original.id()));
        assertEquals(1, creators.count());
        service.deleteRecommendation("UP", original.id(), changed.version());
        assertEquals(0, creators.count());
    }

    @Test void concurrentEditsFromOneVersionHaveOneWinnerAndOneConflict() throws Exception {
        final RecommendationDtos.Detail original = service.createRecommendation(save("123", 3, List.of(1L), null, null), null);
        final List<String> results = race(
                () -> outcome(() -> service.updateRecommendation(original.id(), save("123", 4, List.of(1L), null, original.version()), null)),
                () -> outcome(() -> service.updateRecommendation(original.id(), save("123", 5, List.of(2L), null, original.version()), null)));
        assertEquals(1, results.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, results.stream().filter(ApiErrorCode.CREATOR_CONFIG_CONFLICT.name()::equals).count());
        assertEquals(1, service.recommendationDetail("UP", original.id()).version());
        assertTrue(List.of(8, 10).contains(card(original.id()).score()));
    }

    @Test void deletingACategoryIncrementsOnlyLinkedCreatorVersionsAndRejectsTheirOldDrafts() {
        final RecommendationDtos.Detail first = create(3, List.of(1L, 2L), null);
        final RecommendationDtos.Detail second = create(3, List.of(1L, 3L), null);
        final RecommendationDtos.Detail untouched = create(3, List.of(2L), null);
        service.deleteRecommendationCategory("UP", 1);
        assertEquals(1, service.recommendationDetail("UP", first.id()).version());
        assertEquals(List.of(2L), service.recommendationDetail("UP", first.id()).categoryIds());
        assertEquals(1, service.recommendationDetail("UP", second.id()).version());
        assertEquals(List.of(3L), service.recommendationDetail("UP", second.id()).categoryIds());
        assertEquals(untouched, service.recommendationDetail("UP", untouched.id()));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.updateRecommendation(first.id(), save(first.externalId(), 5, List.of(2L), null, first.version()), null));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT, () -> service.deleteRecommendation("UP", first.id(), first.version()));
        assertCode(ApiErrorCode.CREATOR_CATEGORY_IN_USE, () -> service.deleteRecommendationCategory("UP", 3));
        assertEquals(1, service.recommendationDetail("UP", second.id()).version());
        final RecommendationDtos.Detail refreshed = service.recommendationDetail("UP", first.id());
        assertEquals(2, service.updateRecommendation(first.id(), save(first.externalId(), 5, List.of(2L), null, refreshed.version()), null).version());
        final long unused = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("UP", "Unused")).id();
        service.deleteRecommendationCategory("UP", unused);
        assertEquals(2, service.recommendationDetail("UP", first.id()).version());
        assertEquals(untouched, service.recommendationDetail("UP", untouched.id()));
    }

    @Test void v36UpgradePreservesUpDataAndAddsOnlyTypedConstraints() {
        jdbc.execute("create database recommendation_upgrade");
        final String url = POSTGRES.getJdbcUrl().replace("/wotb", "/recommendation_upgrade");
        final JdbcTemplate upgrade = new JdbcTemplate(new DriverManagerDataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()));
        try {
            Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).target("36").load().migrate();
            upgrade.update("update creator_category set name='Customized category' where id=1");
            upgrade.update("insert into creator_avatar(id,object_key,status,content_type,size,hash,created_at) "
                    + "values ('11111111-1111-4111-8111-111111111111','creator-avatars/old','READY','image/png',1,?,now())", "a".repeat(64));
            upgrade.update("insert into creator(bilibili_uid,name,version,stars,level_id,avatar_id,created_at) "
                    + "values ('123','Preserved UP',7,4,1,'11111111-1111-4111-8111-111111111111',now())");
            upgrade.update("insert into creator_category_link(creator_id,category_id) values (1,1)");
            final String query = "select c.id,c.version,c.bilibili_uid,c.name,c.stars,c.level_id,c.avatar_id,c.created_at,"
                    + "a.object_key,a.hash,cat.name as category_name,l.name as level_name from creator c "
                    + "join creator_avatar a on a.id=c.avatar_id join creator_category_link link on link.creator_id=c.id "
                    + "join creator_category cat on cat.id=link.category_id join creator_level l on l.id=c.level_id";
            final var before = upgrade.queryForMap(query);
            final Flyway flyway = Flyway.configure().dataSource(url, POSTGRES.getUsername(), POSTGRES.getPassword()).load();
            flyway.migrate(); flyway.validate();
            assertEquals(before, upgrade.queryForMap(query));
            assertEquals("UP", upgrade.queryForObject("select type from creator", String.class));
            assertEquals(6, upgrade.queryForObject("select count(*) from creator_category where type='UP'", Integer.class));
            assertEquals(0, upgrade.queryForObject("select count(*) from creator_category where type='VIDEO'", Integer.class));
            assertEquals(4, upgrade.queryForObject("select count(*) from creator_level", Integer.class));
            assertNull(upgrade.queryForObject("select to_regclass('creator_catalog_lock')::text", String.class));
            assertEquals("46", flyway.info().current().getVersion().toString());
        } finally { jdbc.execute("drop database recommendation_upgrade with (force)"); }
    }

    @Test void typedCatalogPreservesBvCaseAndUpIdentityWhileKeepingEmptyDictionariesPrivate() {
        final long videoCategory = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        final long unused = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Empty")).id();
        final RecommendationDtos.Detail up = create(3, List.of(1L), 1L);
        final RecommendationDtos.Detail video = service.createRecommendation(video("  BV1AbCdEfGh2  ", List.of(videoCategory), null), null);
        final RecommendationDtos.Detail lower = service.createRecommendation(video("BV1abcdefgh2", List.of(videoCategory), null), null);
        assertEquals("VIDEO", video.type()); assertEquals("BV1AbCdEfGh2", video.externalId()); assertNull(video.levelId());
        assertEquals(List.of(up.id()), service.recommendations("UP", null).stream().map(RecommendationDtos.Card::id).toList());
        assertEquals(List.of(1L), service.publicRecommendationCategories().stream().filter(category -> "UP".equals(category.type())).map(RecommendationDtos.Category::id).toList());
        assertEquals(List.of(lower.id(), video.id()), service.recommendations("VIDEO", null).stream().map(RecommendationDtos.Card::id).toList());
        final RecommendationDtos.Card card = service.recommendations("VIDEO", null).getLast();
        assertEquals("https://www.bilibili.com/video/BV1AbCdEfGh2", card.targetUrl()); assertNull(card.level()); assertEquals(6, card.score());
        assertEquals(List.of(videoCategory, unused), service.recommendationMetadata("VIDEO").categories().stream().map(RecommendationDtos.Category::id).toList());
        assertTrue(service.recommendationMetadata("VIDEO").levels().isEmpty());
        assertEquals(List.of(1L, videoCategory), service.publicRecommendationCategories().stream().map(RecommendationDtos.Category::id).toList());
        service.deleteRecommendation("VIDEO", video.id(), video.version());
        service.deleteRecommendation("VIDEO", lower.id(), lower.version());
        assertEquals(List.of(1L), service.publicRecommendationCategories().stream().map(RecommendationDtos.Category::id).toList());
    }

    @Test void crossTypeIdsCannotBeReadUpdatedDeletedOrAssociated() {
        final long videoCategory = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        final RecommendationDtos.Detail up = create(3, List.of(1L), null);
        final RecommendationDtos.Detail video = service.createRecommendation(video("BV1AbCdEfGh2", List.of(videoCategory), null), null);
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.recommendationDetail("UP", video.id()));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.deleteRecommendation("UP", video.id(), video.version()));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.updateRecommendation(video.id(), save("123", 3, List.of(1L), null, video.version()), null));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.recommendationDetail("VIDEO", up.id()));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.deleteRecommendation("VIDEO", up.id(), up.version()));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.updateRecommendation(up.id(), video("BV1AbCdEfGh3", List.of(videoCategory), up.version()), null));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.deleteRecommendationCategory("UP", videoCategory));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.deleteRecommendationCategory("VIDEO", 1));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.createRecommendation(video("BV1AbCdEfGh3", List.of(1L), null), null));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.createRecommendation(save("555", 3, List.of(videoCategory), null, null), null));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.recommendations("UP", videoCategory));
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.recommendations("VIDEO", 1L));
        assertEquals(2, creators.count());
    }

    @Test void typedValidationAndDatabaseConstraintsRejectInvalidVideosAndVideoLevels() {
        final long category = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        for (final String invalid : List.of("bv1AbCdEfGh2", "BV1AbCdEfGh", "BV1AbCdEfGh23", "BV1AbCdEfG_2", "123", "BV1Ab CdEfG2")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(video(invalid, List.of(category), null), null));
        }
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.createRecommendation(
                new RecommendationDtos.SaveRequest("VIDEO", "BV1AbCdEfGh2", "Video", null, List.of(category), 1L, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.recommendations("OTHER", null));
        final RecommendationDtos.Detail created = service.createRecommendation(video("\uFEFFBV1AbCdEfGh2\u00A0", List.of(category), null), null);
        assertEquals("BV1AbCdEfGh2", created.externalId());
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update creator set level_id=1 where id=?", created.id()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update creator set type='UP' where id=?", created.id()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update creator set bilibili_uid='bad' where id=?", created.id()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("insert into creator(type,bilibili_uid,name,created_at) values ('VIDEO','BV1AbCdEfGh2','Duplicate',now())"));
        assertEquals(List.of("type", "bilibili_uid"), jdbc.queryForList("select a.attname from pg_constraint con "
                + "cross join lateral unnest(con.conkey) with ordinality k(attnum,ord) join pg_attribute a "
                + "on a.attrelid=con.conrelid and a.attnum=k.attnum where con.conname='creator_type_external_id_unique' order by k.ord", String.class));
    }

    @Test void concurrentVideoCreationAndCategoryRemovalKeepOneRecordWithValidMembership() throws Exception {
        final long category = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        final var request = video("BV1AbCdEfGh2", List.of(category), null);
        final List<String> duplicate = race(() -> outcome(() -> service.createRecommendation(request, null)),
                () -> outcome(() -> service.createRecommendation(request, null)));
        assertEquals(1, duplicate.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, duplicate.stream().filter(ApiErrorCode.RECOMMENDATION_ID_ALREADY_EXISTS.name()::equals).count());
        final long second = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Other")).id();
        final var original = service.recommendations("VIDEO", null).getFirst();
        final List<String> change = race(() -> outcome(() -> service.updateRecommendation(original.id(), video("BV1AbCdEfGh2", List.of(second), original.version()), null)),
                () -> outcome(() -> service.deleteRecommendationCategory("VIDEO", second)));
        assertEquals(1, change.stream().filter("SUCCESS"::equals).count());
        assertEquals(0, jdbc.queryForObject("select count(*) from creator c where not exists (select 1 from creator_category_link l where l.creator_id=c.id)", Integer.class));
        assertEquals(1, creators.count());
        final var latest = service.recommendationDetail("VIDEO", original.id());
        if (latest.version() > original.version()) {
            assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT, () -> service.deleteRecommendation("VIDEO", latest.id(), original.version()));
        }
    }

    @Test void realHttpEnforcesRolesStrictRequestsAndTypedBoundaries() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        final var admin = jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin"));
        final var wrongAdmin = jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"));
        final var tournamentAdmin = jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"));
        final long category = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        final JsonMapper json = JsonMapper.builder().build();
        final String payload = json.writeValueAsString(video("BV1AbCdEfGh2", List.of(category), null));
        mvc.perform(get("/api/recommendations?type=VIDEO")).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/recommendations")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/recommendations?type=BAD")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/recommendations/metadata?type=VIDEO")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/recommendations/metadata?type=VIDEO").with(wrongAdmin)).andExpect(status().isForbidden());
        // The tournament domain never authorizes content management, not even as a fallback.
        mvc.perform(get("/api/admin/recommendations/metadata?type=VIDEO").with(tournamentAdmin)).andExpect(status().isForbidden());
        mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(payload)).with(tournamentAdmin)).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/recommendations/metadata?type=VIDEO").with(admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("VIDEO")).andExpect(jsonPath("$.levels").isEmpty()).andExpect(jsonPath("$.categories[0].type").value("VIDEO"));
        mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(payload))).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(payload)).with(wrongAdmin)).andExpect(status().isForbidden());
        final String created = mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(payload)).with(admin))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.type").value("VIDEO"))
                .andExpect(jsonPath("$.externalId").value("BV1AbCdEfGh2")).andExpect(jsonPath("$.bilibiliUid").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        final long id = json.readTree(created).path("id").asLong();
        mvc.perform(get("/api/recommendations?type=VIDEO")).andExpect(status().isOk()).andExpect(jsonPath("$[0].targetUrl").value("https://www.bilibili.com/video/BV1AbCdEfGh2"));
        mvc.perform(get("/api/recommendations?type=UP")).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/recommendations/categories")).andExpect(status().isOk()).andExpect(jsonPath("$[0].type").value("VIDEO"));
        mvc.perform(get("/api/admin/creators/" + id).with(admin)).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/recommendations/" + id + "?type=UP").with(admin)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/admin/creators/" + id + "?expectedVersion=0").with(admin)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/creators/categories/" + category).with(admin)).andExpect(status().isForbidden());
        for (final String invalid : List.of(payload.replace("\"VIDEO\"", "null"), payload.replace("\"BV1AbCdEfGh2\"", "123"),
                payload.replace("\"levelId\":null", "\"levelId\":1"), payload.replace("\"stars\":3", "\"stars\":3.1"),
                payload.replace("\"externalId\":", "\"extra\":true,\"externalId\":"))) {
            mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(invalid)).with(admin)).andExpect(status().isBadRequest());
        }
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/recommendations/" + id).file(jsonPayload(json.writeValueAsString(video("BV1AbCdEfGh2", List.of(category), 0L)))).with(admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        mvc.perform(delete("/api/admin/recommendations/" + id + "?type=VIDEO&expectedVersion=0").with(admin)).andExpect(status().isConflict());
        mvc.perform(delete("/api/admin/recommendations/" + id + "?type=VIDEO&expectedVersion=1").with(admin)).andExpect(status().isNoContent());
    }

    @Test void recommendationHttpRejectsScalarTextCoercionAndPreservesNullableDescription() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        final var admin = jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin"));
        final long category = service.addRecommendationCategory(new RecommendationDtos.CategoryRequest("VIDEO", "Clips")).id();
        final JsonMapper json = JsonMapper.builder().build();
        final var valid = video("BV1AbCdEfGh2", List.of(category), null);
        for (final String field : List.of("type", "externalId", "name", "description", "imageAction")) {
            for (final boolean numeric : List.of(true, false)) {
                final var payload = (tools.jackson.databind.node.ObjectNode) json.valueToTree(valid);
                if (numeric) { payload.put(field, 123); } else { payload.put(field, true); }
                mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(json.writeValueAsString(payload))).with(admin))
                        .andExpect(status().isBadRequest());
            }
        }
        for (final String field : List.of("type", "name")) {
            for (final boolean numeric : List.of(true, false)) {
                final var payload = json.createObjectNode().put("type", "VIDEO").put("name", "Clips");
                if (numeric) { payload.put(field, 123); } else { payload.put(field, true); }
                mvc.perform(post("/api/admin/recommendations/categories").contentType("application/json")
                                .content(json.writeValueAsString(payload)).with(admin))
                        .andExpect(status().isBadRequest());
            }
        }
        assertEquals(0, creators.count());
        assertEquals(1, service.recommendationMetadata("VIDEO").categories().size());
        final String result = mvc.perform(multipart("/api/admin/recommendations").file(jsonPayload(json.writeValueAsString(valid))).with(admin))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        assertTrue(json.readTree(result).has("description"));
        assertTrue(json.readTree(result).path("description").isNull());
        mvc.perform(post("/api/admin/recommendations/categories").contentType("application/json")
                        .content("{\"type\":\"VIDEO\",\"name\":\"123\"}").with(admin))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("123"));
    }

    private static MockMultipartFile jsonPayload(final String value) {
        return new MockMultipartFile("payload", "", "application/json", value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    private static RecommendationDtos.SaveRequest video(final String bv, final List<Long> categories, final Long version) {
        return new RecommendationDtos.SaveRequest("VIDEO", bv, "Video", null, categories, null, 3, "KEEP", version);
    }

    private RecommendationDtos.Detail create(final int stars, final List<Long> ids, final Long levelId) {
        return service.createRecommendation(save(Long.toString(++nextUid), stars, ids, levelId, null), null);
    }
    private static RecommendationDtos.SaveRequest save(final String uid, final int stars, final List<Long> ids, final Long levelId,
                                              final Long expectedVersion) {
        return new RecommendationDtos.SaveRequest("UP", uid, "Creator", null, ids, levelId, stars, "KEEP", expectedVersion);
    }
    private RecommendationDtos.Card card(final long id) {
        return service.recommendations("UP", null).stream().filter(creator -> creator.id() == id).findFirst().orElseThrow();
    }
    private static void assertCode(final ApiErrorCode code, final Runnable operation) {
        assertEquals(code, assertThrows(ApiException.class, operation::run).errorCode());
    }
    private static String outcome(final Runnable operation) {
        try { operation.run(); return "SUCCESS"; }
        catch (final ApiException e) { return e.errorCode().name(); }
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
