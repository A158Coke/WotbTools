package com.wotb.web.creator;

import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.util.apierror.ApiErrorCode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CreatorTypedCatalogHttpIntegrationTest extends CreatorIntegrationTestSupport {

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
}
