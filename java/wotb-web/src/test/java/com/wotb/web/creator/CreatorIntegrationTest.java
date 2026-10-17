package com.wotb.web.creator;

import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
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
    private long nextUid;

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
        assertEquals(List.of("creator", "creator_avatar", "creator_catalog_lock", "creator_category", "creator_category_link", "creator_level"),
                jdbc.queryForList("select tablename from pg_tables where schemaname='public' and tablename like 'creator%' order by tablename", String.class));
        assertEquals(1L, jdbc.queryForObject("select id from creator_catalog_lock", Long.class));
        assertFalse(service.metadata().avatarUploadsAvailable());
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
        final CreatorDtos.Detail detail = service.create(
                new CreatorDtos.SaveRequest(" 000123 ", " Creator ", " Description ", List.of(2L, 1L), 1L, 3, "KEEP", null), null);
        assertEquals("123", detail.bilibiliUid());
        assertEquals("Creator", detail.name());
        assertEquals("Description", detail.description());
        assertEquals(List.of(1L, 2L), detail.categoryIds());
        assertEquals(3, detail.stars());
        assertEquals(0L, detail.version());
        assertNull(detail.avatarUrl());
        final CreatorDtos.Card card = card(detail.id());
        assertEquals(detail.version(), card.version());
        assertEquals("123", card.bilibiliUid());
        assertEquals("https://space.bilibili.com/123", card.homepageUrl());
        assertEquals(6, card.score());
        assertEquals(2, card.categories().size());
        assertEquals("Basic", card.level().name());
        assertEquals(detail.id(), service.list(2L).getFirst().id());
        assertEquals(1, service.list(null).size());
        assertEquals(List.of(), service.list(999L));
    }

    @Test void twentyDigitUidRemainsAnExactString() {
        final String uid = "12345678901234567890";
        final CreatorDtos.Detail detail = service.create(save(uid, 5, List.of(1L), null, null), null);
        assertEquals(uid, detail.bilibiliUid());
        assertEquals(uid, service.detail(detail.id()).bilibiliUid());
        assertEquals("https://space.bilibili.com/" + uid, card(detail.id()).homepageUrl());
        assertEquals(10, card(detail.id()).score());
    }

    @Test void publicCategoriesFollowCommittedMembershipWhileMetadataKeepsEmptyCategories() {
        final List<CreatorDtos.Category> dictionary = List.of(new CreatorDtos.Category(1, "A"),
                new CreatorDtos.Category(2, "B"), new CreatorDtos.Category(3, "C"));
        assertEquals(List.of(), service.publicCategories());
        assertEquals(dictionary, service.metadata().categories());

        final CreatorDtos.Detail first = create(3, List.of(2L), null);
        assertEquals(List.of(dictionary.get(1)), service.publicCategories());
        final CreatorDtos.Detail second = create(3, List.of(3L, 2L), null);
        assertEquals(List.of(dictionary.get(1), dictionary.get(2)), service.publicCategories());
        assertEquals(List.of(dictionary.get(1), dictionary.get(2)), card(second.id()).categories());
        assertEquals(dictionary, service.metadata().categories());

        final CreatorDtos.Detail moved = service.update(second.id(),
                save(second.bilibiliUid(), 3, List.of(1L), null, second.version()), null);
        assertEquals(List.of(dictionary.get(0), dictionary.get(1)), service.publicCategories());
        assertEquals(List.of(dictionary.get(0)), card(moved.id()).categories());
        service.delete(first.id(), first.version());
        assertEquals(List.of(dictionary.get(0)), service.publicCategories());
        service.delete(moved.id(), moved.version());
        assertEquals(List.of(), service.publicCategories());
        assertEquals(dictionary, service.metadata().categories());
        assertEquals(dictionary, service.categories());
    }

    @Test void publicCategoryHttpResponseIsTheSameForEveryRoleWhileAdminMetadataRemainsComplete() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        mvc.perform(get("/api/creators/categories")).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        create(3, List.of(2L), null);
        mvc.perform(get("/api/creators/categories")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].id").value(2));
        for (final String role : List.of("wotbtools-user", "HoF-admin", "wotbtools-admin", "tournament-admin")) {
            mvc.perform(get("/api/creators/categories").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                    .andExpect(jsonPath("$[0].id").value(2)).andExpect(jsonPath("$[0].name").value("B"));
        }
        mvc.perform(get("/api/admin/creators/metadata")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/creators/metadata").with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/creators/metadata")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.categories.length()").value(3))
                .andExpect(jsonPath("$.categories[0].name").value("A"))
                .andExpect(jsonPath("$.categories[2].name").value("C"));
    }

    @Test void concurrentEquivalentUidsProduceOneCreatorAndOneCanonicalConflict() throws Exception {
        final List<String> results = race(
                () -> outcome(() -> service.create(save("00123", 3, List.of(1L), null, null), null)),
                () -> outcome(() -> service.create(save("123", 4, List.of(2L), null, null), null)));
        assertEquals(1, results.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, results.stream().filter(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS.name()::equals).count());
        assertEquals(1, creators.count());
        assertEquals("123", service.list(null).getFirst().bilibiliUid());
    }

    @Test void duplicateUidUpdateRollsBackAllEditableFields() {
        final CreatorDtos.Detail first = service.create(save("123", 3, List.of(1L), 1L, null), null);
        final CreatorDtos.Detail second = service.create(save("456", 2, List.of(2L), null, null), null);
        assertCode(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS,
                () -> service.update(second.id(), save("000123", 5, List.of(3L), 2L, second.version()), null));
        assertEquals(second, service.detail(second.id()));
        assertEquals(first, service.detail(first.id()));
        assertEquals(2, creators.count());
    }

    @Test void editsKeepIdentityAndCreationTimeWhileReplacingAllAdministratorFields() {
        final CreatorDtos.Detail created = service.create(save("123", 3, List.of(1L), 1L, null), null);
        final var createdAt = card(created.id()).createdAt();
        final CreatorDtos.Detail updated = service.update(created.id(),
                new CreatorDtos.SaveRequest("000456", " Renamed ", null, List.of(2L, 3L), null, 5, "REMOVE", created.version()), null);
        assertEquals(created.id(), updated.id());
        assertEquals(created.version() + 1, updated.version());
        assertEquals(createdAt, card(created.id()).createdAt());
        assertEquals("456", updated.bilibiliUid());
        assertEquals("Renamed", updated.name());
        assertNull(updated.description());
        assertNull(updated.levelId());
        assertNull(updated.avatarUrl());
        assertEquals(List.of(2L, 3L), updated.categoryIds());
        assertEquals(10, card(created.id()).score());
        assertNull(card(created.id()).level());
        assertEquals("https://space.bilibili.com/456", card(created.id()).homepageUrl());
        final CreatorDtos.Detail repeated = service.update(created.id(), new CreatorDtos.SaveRequest("456", "Renamed", null,
                List.of(2L, 3L), null, 5, "KEEP", updated.version()), null);
        assertEquals(updated.version() + 1, repeated.version());
        assertEquals(updated.bilibiliUid(), repeated.bilibiliUid());
        assertEquals(updated.categoryIds(), repeated.categoryIds());
        assertEquals("123", service.create(save("123", 3, List.of(1L), null, null), null).bilibiliUid());
    }

    @Test void sortingUsesManualStarsThenOriginalCreationTimeAndStableId() {
        final long older = create(5, List.of(1L, 2L), null).id();
        final long newer = create(5, List.of(1L), null).id();
        final long lower = create(4, List.of(1L), null).id();
        jdbc.update("update creator set created_at='2026-10-15T00:00:00Z' where id=?", older);
        jdbc.update("update creator set created_at='2026-10-16T00:00:00Z' where id in (?,?)", newer, lower);
        assertEquals(List.of(newer, older, lower), service.list(1L).stream().map(CreatorDtos.Card::id).toList());
        jdbc.update("update creator set created_at='2026-10-16T00:00:00Z' where id=?", older);
        assertEquals(List.of(newer, older, lower), service.list(null).stream().map(CreatorDtos.Card::id).toList());
        assertEquals(3, service.list(null).size());
        assertEquals(2, card(older).categories().size());
    }

    @Test void concurrentCategoryDeletesCannotLeaveACreatorWithoutAnyCategory() throws Exception {
        final long id = create(3, List.of(1L, 2L), null).id();
        final List<String> results = race(
                () -> outcome(() -> service.deleteCategory(1)),
                () -> outcome(() -> service.deleteCategory(2)));
        assertEquals(1, results.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, results.stream().filter(ApiErrorCode.CREATOR_CATEGORY_IN_USE.name()::equals).count());
        final long remaining = card(id).categories().getFirst().id();
        assertEquals(1, card(id).categories().size());
        assertEquals(1, card(id).version());
        assertCode(ApiErrorCode.CREATOR_CATEGORY_IN_USE, () -> service.deleteCategory(remaining));
        assertEquals(2, service.categories().size());
    }

    @Test void categoryEditsAndLevelDeletesSerializeWithoutInvalidReferences() throws Exception {
        final long categoryCreator = create(3, List.of(1L, 2L), null).id();
        race(() -> outcome(() -> service.update(categoryCreator,
                        save(service.detail(categoryCreator).bilibiliUid(), 3, List.of(2L), null, 0L), null)),
                () -> outcome(() -> service.deleteCategory(2)));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from creator c where not exists
                (select 1 from creator_category_link l where l.creator_id=c.id)
                """, Integer.class));
        final long levelCreator = create(3, List.of(1L), null).id();
        final String uid = service.detail(levelCreator).bilibiliUid();
        race(() -> outcome(() -> service.update(levelCreator, save(uid, 3, List.of(1L), 2L, 0L), null)),
                () -> outcome(() -> service.deleteLevel(2)));
        assertEquals(0, jdbc.queryForObject("""
                select count(*) from creator c where c.level_id is not null and not exists
                (select 1 from creator_level l where l.id=c.level_id)
                """, Integer.class));
    }

    @Test void dictionaryMaintenanceHonorsReferenceProtectionAndSupportsDisablingAssessment() {
        final long id = create(3, List.of(1L), 1L).id();
        assertCode(ApiErrorCode.CREATOR_LEVEL_IN_USE, () -> service.deleteLevel(1));
        final CreatorDtos.Category category = service.addCategory(new CreatorDtos.DictionaryRequest(" New category "));
        final CreatorDtos.Level level = service.addLevel(new CreatorDtos.DictionaryRequest(" New level "));
        assertEquals("New category", category.name());
        assertEquals("New level", level.name());
        service.deleteCategory(category.id());
        service.deleteLevel(level.id());
        service.update(id, save(service.detail(id).bilibiliUid(), 3, List.of(1L), null, service.detail(id).version()), null);
        service.deleteLevel(1);
        assertNull(card(id).level());
        assertEquals(1, service.metadata().levels().size());
    }

    @Test void invalidDirectoryInputsLeaveExistingRecordsUnchanged() {
        final CreatorDtos.Detail original = create(3, List.of(1L), 1L);
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(null, null));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.update(original.id(), save(original.bilibiliUid(), 1, List.of(999L), null, original.version()), null));
        assertEquals(original, service.detail(original.id()));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.create(save("999", 3, List.of(1L), 999L, null), null));
        for (final String uid : Arrays.asList(null, "", " ", "0", "0000", "-1", "+1", "1.5",
                "1e3", "１２３", "https://space.bilibili.com/123", "123456789012345678901")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.create(save(uid, 3, List.of(1L), null, null), null));
        }
        for (final int stars : new int[] {0, 6}) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.create(save("999", stars, List.of(1L), null, null), null));
        }
        for (final List<Long> ids : Arrays.<List<Long>>asList(null, List.of(), List.of(1L, 1L), List.of(0L), Arrays.asList(1L, null))) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.create(save("999", 3, ids, null, null), null));
        }
        for (final String name : Arrays.asList(null, "", " ", "x".repeat(101))) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.create(new CreatorDtos.SaveRequest("999", name, null, List.of(1L), null, 3, "KEEP", null), null));
        }
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.create(save("999", 3, List.of(1L), 0L, null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.create(new CreatorDtos.SaveRequest("999", "N", "x".repeat(2001), List.of(1L), null, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addCategory(new CreatorDtos.DictionaryRequest(" ")));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addLevel(new CreatorDtos.DictionaryRequest("x".repeat(101))));
        assertEquals(1, creators.count());
    }

    @Test void avatarActionAndFilePresenceMustAgreeBeforeAnyDirectoryWrite() {
        final MockMultipartFile file = new MockMultipartFile("avatar", "image.png", "image/png", new byte[] {1});
        for (final String action : Arrays.asList(null, "", "keep", "UNKNOWN", "REPLACE")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(
                    new CreatorDtos.SaveRequest("999", "N", null, List.of(1L), null, 3, action, null), null));
        }
        for (final String action : List.of("KEEP", "REMOVE")) {
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(
                    new CreatorDtos.SaveRequest("999", "N", null, List.of(1L), null, 3, action, null), file));
        }
        assertEquals(0, creators.count());
        assertEquals(0, jdbc.queryForObject("select count(*) from creator_avatar", Integer.class));
        assertNull(service.create(save("999", 3, List.of(1L), null, null), null).avatarUrl());
    }

    @Test void removalOnlyDeletesItsCreatorAndCategoryCompositionAndReleasesTheUid() {
        final CreatorDtos.Detail removed = service.create(save("123", 3, List.of(1L, 2L), 1L, null), null);
        final CreatorDtos.Detail retained = service.create(save("456", 3, List.of(2L), 2L, null), null);
        service.delete(removed.id(), removed.version());
        assertCode(ApiErrorCode.CREATOR_NOT_FOUND, () -> service.detail(removed.id()));
        assertEquals(retained, service.detail(retained.id()));
        assertEquals(1, jdbc.queryForObject("select count(*) from creator_category_link", Integer.class));
        assertEquals(3, service.categories().size());
        assertEquals(2, service.metadata().levels().size());
        assertEquals("123", service.create(save("123", 3, List.of(1L), null, null), null).bilibiliUid());
    }

    @Test void uidWhitespaceMatchesEcmascriptThroughMultipartAndPersistence() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        final var json = JsonMapper.builder().findAndAddModules().build();
        final var admin = jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"));
        final int[] whitespace = {9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
                8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279};
        for (final int codePoint : whitespace) {
            final String padding = Character.toString(codePoint), uid = Integer.toString(600000 + codePoint);
            final CreatorDtos.SaveRequest valid = save(padding + "000" + uid + padding, 3, List.of(1L), null, null);
            mvc.perform(multipart("/api/admin/creators").file(new MockMultipartFile("payload", "", "application/json", json.writeValueAsBytes(valid))).with(admin))
                    .andExpect(status().isCreated()).andExpect(jsonPath("$.bilibiliUid").value(uid));
            assertTrue(creators.existsByBilibiliUid(uid));
            for (final String invalid : List.of(padding + "000" + padding, "12" + padding + "3")) {
                mvc.perform(multipart("/api/admin/creators").file(new MockMultipartFile("payload", "", "application/json",
                                json.writeValueAsBytes(save(invalid, 3, List.of(1L), null, null)))).with(admin))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("CREATOR_INVALID_REQUEST"));
            }
        }
        // Java trim/strip or UNICODE_CHARACTER_CLASS must not broaden the wire contract.
        for (final int codePoint : new int[] {0, 8, 14, 28, 31, 133, 6158, 8191, 8203, 8234, 8288, 8289, 12289}) {
            final String padding = Character.toString(codePoint);
            assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    () -> service.create(save(padding + "123" + padding, 3, List.of(1L), null, null), null));
        }
        assertEquals(whitespace.length, creators.count());
    }

    @Test void unicodeLimitsCountCodePointsForCreatorAndDictionaryNamesAndDescription() {
        final String name = "😀".repeat(100);
        final String description = "🚀".repeat(2000);
        final CreatorDtos.Detail created = service.create(new CreatorDtos.SaveRequest("300001", " " + name + " ",
                description, List.of(1L), null, 3, "KEEP", null), null);
        assertEquals(name, created.name());
        assertEquals(description, created.description());
        assertEquals(100, jdbc.queryForObject("select length(name) from creator where id=?", Integer.class, created.id()));
        assertEquals(2000, jdbc.queryForObject("select length(description) from creator where id=?", Integer.class, created.id()));
        assertEquals(name, service.addCategory(new CreatorDtos.DictionaryRequest(" " + name + " ")).name());
        assertEquals(name, service.addLevel(new CreatorDtos.DictionaryRequest(" " + name + " ")).name());
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(new CreatorDtos.SaveRequest("300002", name + "😀",
                null, List.of(1L), null, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.create(new CreatorDtos.SaveRequest("300003", name,
                description + "🚀", List.of(1L), null, 3, "KEEP", null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addCategory(new CreatorDtos.DictionaryRequest(name + "😀")));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.addLevel(new CreatorDtos.DictionaryRequest(name + "😀")));
        assertEquals(1, creators.count());
    }

    @Test void unicodeLimitsSurviveRealMultipartBindingAndPostgresqlPersistence() throws Exception {
        final MockMvc mvc = MockMvcBuilders.webAppContextSetup(web).apply(springSecurity()).build();
        final var json = JsonMapper.builder().findAndAddModules().build();
        final var admin = jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"));
        final String name = "😀".repeat(100), description = "🚀".repeat(2000);
        final CreatorDtos.SaveRequest valid = new CreatorDtos.SaveRequest("300001", name, description, List.of(1L), null, 3, "KEEP", null);
        mvc.perform(multipart("/api/admin/creators").file(new MockMultipartFile("payload", "", "application/json", json.writeValueAsBytes(valid))).with(admin))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value(name))
                .andExpect(jsonPath("$.description").value(description)).andExpect(jsonPath("$.version").value(0));
        for (final CreatorDtos.SaveRequest invalid : List.of(
                new CreatorDtos.SaveRequest("300002", name + "😀", null, List.of(1L), null, 3, "KEEP", null),
                new CreatorDtos.SaveRequest("300003", name, description + "🚀", List.of(1L), null, 3, "KEEP", null))) {
            mvc.perform(multipart("/api/admin/creators").file(new MockMultipartFile("payload", "", "application/json", json.writeValueAsBytes(invalid))).with(admin))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("CREATOR_INVALID_REQUEST"));
        }
        for (final String dictionary : List.of("categories", "levels")) {
            mvc.perform(post("/api/admin/creators/" + dictionary).contentType("application/json")
                            .content(json.writeValueAsBytes(new CreatorDtos.DictionaryRequest(name))).with(admin))
                    .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value(name));
            mvc.perform(post("/api/admin/creators/" + dictionary).contentType("application/json")
                            .content(json.writeValueAsBytes(new CreatorDtos.DictionaryRequest(name + "😀"))).with(admin))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("CREATOR_INVALID_REQUEST"));
        }
        assertEquals(1, creators.count());
        assertEquals(description, service.list(null).getFirst().description());
    }

    @Test void operationVersionsRejectInvalidRequestsAndStaleUpdateOrRemoval() {
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.create(save("123", 3, List.of(1L), null, 0L), null));
        final CreatorDtos.Detail original = service.create(save("123", 3, List.of(1L), null, null), null);
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.update(original.id(), save("123", 4, List.of(1L), null, null), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST,
                () -> service.update(original.id(), save("123", 4, List.of(1L), null, -1L), null));
        assertCode(ApiErrorCode.CREATOR_INVALID_REQUEST, () -> service.delete(original.id(), -1));
        final CreatorDtos.Detail changed = service.update(original.id(), save("123", 4, List.of(2L), null, original.version()), null);
        assertEquals(1, changed.version());
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.update(original.id(), save("456", 1, List.of(3L), null, original.version()), null));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT, () -> service.delete(original.id(), original.version()));
        assertEquals(changed, service.detail(original.id()));
        assertEquals(1, creators.count());
        service.delete(original.id(), changed.version());
        assertEquals(0, creators.count());
    }

    @Test void concurrentEditsFromOneVersionHaveOneWinnerAndOneConflict() throws Exception {
        final CreatorDtos.Detail original = service.create(save("123", 3, List.of(1L), null, null), null);
        final List<String> results = race(
                () -> outcome(() -> service.update(original.id(), save("123", 4, List.of(1L), null, original.version()), null)),
                () -> outcome(() -> service.update(original.id(), save("123", 5, List.of(2L), null, original.version()), null)));
        assertEquals(1, results.stream().filter("SUCCESS"::equals).count());
        assertEquals(1, results.stream().filter(ApiErrorCode.CREATOR_CONFIG_CONFLICT.name()::equals).count());
        assertEquals(1, service.detail(original.id()).version());
        assertTrue(List.of(8, 10).contains(card(original.id()).score()));
    }

    @Test void deletingACategoryIncrementsOnlyLinkedCreatorVersionsAndRejectsTheirOldDrafts() {
        final CreatorDtos.Detail first = create(3, List.of(1L, 2L), null);
        final CreatorDtos.Detail second = create(3, List.of(1L, 3L), null);
        final CreatorDtos.Detail untouched = create(3, List.of(2L), null);
        service.deleteCategory(1);
        assertEquals(1, service.detail(first.id()).version());
        assertEquals(List.of(2L), service.detail(first.id()).categoryIds());
        assertEquals(1, service.detail(second.id()).version());
        assertEquals(List.of(3L), service.detail(second.id()).categoryIds());
        assertEquals(untouched, service.detail(untouched.id()));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT,
                () -> service.update(first.id(), save(first.bilibiliUid(), 5, List.of(2L), null, first.version()), null));
        assertCode(ApiErrorCode.CREATOR_CONFIG_CONFLICT, () -> service.delete(first.id(), first.version()));
        assertCode(ApiErrorCode.CREATOR_CATEGORY_IN_USE, () -> service.deleteCategory(3));
        assertEquals(1, service.detail(second.id()).version());
        final CreatorDtos.Detail refreshed = service.detail(first.id());
        assertEquals(2, service.update(first.id(), save(first.bilibiliUid(), 5, List.of(2L), null, refreshed.version()), null).version());
        final long unused = service.addCategory(new CreatorDtos.DictionaryRequest("Unused")).id();
        service.deleteCategory(unused);
        assertEquals(2, service.detail(first.id()).version());
        assertEquals(untouched, service.detail(untouched.id()));
    }

    private CreatorDtos.Detail create(final int stars, final List<Long> ids, final Long levelId) {
        return service.create(save(Long.toString(++nextUid), stars, ids, levelId, null), null);
    }
    private static CreatorDtos.SaveRequest save(final String uid, final int stars, final List<Long> ids, final Long levelId,
                                              final Long expectedVersion) {
        return new CreatorDtos.SaveRequest(uid, "Creator", null, ids, levelId, stars, "KEEP", expectedVersion);
    }
    private CreatorDtos.Card card(final long id) {
        return service.list(null).stream().filter(creator -> creator.id() == id).findFirst().orElseThrow();
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
