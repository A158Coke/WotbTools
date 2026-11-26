package com.wotb.web.creator;

import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.util.apierror.ApiErrorCode;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CreatorDirectoryIntegrationTest extends CreatorIntegrationTestSupport {

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
}
