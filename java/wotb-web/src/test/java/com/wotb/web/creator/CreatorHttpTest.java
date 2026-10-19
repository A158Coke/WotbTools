package com.wotb.web.creator;

import com.wotb.web.creator.dto.RecommendationDtos;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.creator.controller.RecommendationController;
import com.wotb.web.creator.controller.CreatorController;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.replay.controller.ReplayController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CreatorHttpTest {
    private static final String SAVE = """
            {"type":"UP","externalId":"123","name":"Creator","description":null,
             "categoryIds":[1],"levelId":null,"stars":3,"imageAction":"KEEP","expectedVersion":null}
            """;
    private static final SimpleGrantedAuthority CONTENT_ADMIN = new SimpleGrantedAuthority("ROLE_content-admin");
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;

    @BeforeEach void setup() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    @AfterEach void close() { context.close(); }

    @Test void anonymousHealthAdvertisesRecommendationsWithoutReadingTheDirectory() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.tanks").isNumber())
                .andExpect(jsonPath("$.capabilities.length()").value(1))
                .andExpect(jsonPath("$.capabilities[0]").value("recommendations-v1"));
        verifyNoInteractions(service(), avatars());
    }

    @Test void publicDirectoryAndAttachedAvatarAreAnonymousWhileMetadataIsAdministrative() throws Exception {
        when(service().recommendations("UP", null)).thenReturn(List.of());
        when(service().publicRecommendationCategories()).thenReturn(List.of(new RecommendationDtos.Category(1, "Category", "UP")));
        final String avatarId = "11111111-1111-4111-8111-111111111111";
        when(avatars().load(avatarId)).thenReturn(new CreatorAvatarService.AvatarImage(new byte[] {1, 2}, "image/png", "a".repeat(64)));
        mvc.perform(get("/api/recommendations?type=UP")).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mvc.perform(get("/api/recommendations/categories")).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value("Category"));
        mvc.perform(get("/api/creators/avatars/" + avatarId)).andExpect(status().isOk())
                .andExpect(content().contentType("image/png")).andExpect(content().bytes(new byte[] {1, 2}))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(get("/api/admin/recommendations/metadata?type=UP")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/creators").with(jwt().authorities())).andExpect(status().isForbidden());
    }

    @Test void metadataAndEditableDetailsRequireTheRealContentRoleOrItsComposite() throws Exception {
        when(service().recommendationMetadata("UP")).thenReturn(new RecommendationDtos.Metadata("UP",
                List.of(new RecommendationDtos.Category(1, "A", "UP")), List.of(new RecommendationDtos.Level(1, "Expert")), false));
        when(service().recommendationDetail("UP", 7)).thenReturn(detail());
        for (final String path : List.of("/api/admin/recommendations/7?type=UP", "/api/admin/recommendations/metadata?type=UP")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).with(jwt().authorities())).andExpect(status().isForbidden());
            // Domain separation: the tournament role never implies content administration, and the
            // super-admin realm role only works because Keycloak expands its composite claims.
            for (final String role : List.of("ROLE_wotbtools-user", "ROLE_HoF-admin", "ROLE_tournament-admin", "ROLE_wotbtools-admin")) {
                mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority(role)))).andExpect(status().isForbidden());
            }
            mvc.perform(get(path).with(jwt().authorities(CONTENT_ADMIN))).andExpect(status().isOk());
            mvc.perform(get(path).with(jwt().authorities(CONTENT_ADMIN, new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                    .andExpect(status().isOk());
        }
        mvc.perform(get("/api/admin/recommendations/metadata?type=UP").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(jsonPath("$.categories[0].id").value(1)).andExpect(jsonPath("$.levels[0].name").value("Expert"))
                .andExpect(jsonPath("$.imageUploadsAvailable").value(false));
    }

    @Test void ordinaryUsersCannotSaveRemoveOrMaintainDictionaryEntries() throws Exception {
        mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE))).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE)).with(jwt().authorities())).andExpect(status().isForbidden());
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/recommendations/7").file(payload(SAVE)).with(jwt().authorities()))
                .andExpect(status().isForbidden());
        for (final String path : List.of("/api/admin/recommendations/7?type=UP", "/api/admin/recommendations/categories/1", "/api/admin/recommendations/levels/1")) {
            mvc.perform(delete(path)).andExpect(status().isUnauthorized());
            mvc.perform(delete(path).with(jwt().authorities())).andExpect(status().isForbidden());
        }
        for (final String path : List.of("/api/admin/recommendations/categories", "/api/admin/recommendations/levels")) {
            mvc.perform(post(path).contentType("application/json").content("{\"name\":\"New\"}").with(jwt().authorities()))
                    .andExpect(status().isForbidden());
        }
        // Content writes are owned by content-admin: the tournament role is not a compatibility fallback.
        final SimpleGrantedAuthority tournament = new SimpleGrantedAuthority("ROLE_tournament-admin");
        mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE)).with(jwt().authorities(tournament)))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/recommendations/7").queryParam("type", "UP").queryParam("expectedVersion", "1").with(jwt().authorities(tournament)))
                .andExpect(status().isForbidden());
        verifyNoInteractions(service());
    }

    @Test void cardSerializationKeepsExactUidAndExplicitNullsWithoutPrivateOrEditableState() throws Exception {
        final String uid = "12345678901234567890";
        final RecommendationDtos.Card card = new RecommendationDtos.Card(7, 2, "UP", uid, "Creator", null, "https://space.bilibili.com/" + uid, null,
                List.of(new RecommendationDtos.Category(1, "A", "UP"), new RecommendationDtos.Category(2, "B", "UP")), null, 6, Instant.parse("2026-10-16T00:00:00Z"));
        when(service().recommendations("UP", 1L)).thenReturn(List.of(card));
        final String json = mvc.perform(get("/api/recommendations?type=UP&categoryId=1")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].externalId").isString()).andExpect(jsonPath("$[0].externalId").value(uid))
                .andExpect(jsonPath("$[0].score").value(6))
                .andExpect(jsonPath("$[0].version").value(2))
                .andExpect(jsonPath("$[0].categories.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        final var node = JsonMapper.builder().findAndAddModules().build().readTree(json).get(0);
        assertEquals(12, node.properties().size());
        assertEquals(uid, node.path("externalId").asText());
        assertTrue(node.path("description").isNull());
        assertTrue(node.path("imageUrl").isNull());
        assertTrue(node.path("level").isNull());
        assertFalse(node.has("stars"));
        assertFalse(node.has("avatarId"));
        assertFalse(node.has("subject"));
        assertFalse(node.has("favoriteCount"));
    }

    @Test void multipartSaveBindsKeepRemoveAndReplacementWithDeclaredStatuses() throws Exception {
        when(service().createRecommendation(any(), any())).thenReturn(detail());
        when(service().updateRecommendation(eq(7L), any(), any())).thenReturn(new RecommendationDtos.Detail(7, 1, "UP", "123", "Creator", null, List.of(1L), null, 3, null));
        final String createdJson = mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE)).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.id").value(7)).andExpect(jsonPath("$.stars").value(3))
                .andExpect(jsonPath("$.avatarId").doesNotExist()).andExpect(jsonPath("$.targetUrl").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        final var detailJson = JsonMapper.builder().findAndAddModules().build().readTree(createdJson);
        assertEquals(10, detailJson.properties().size());
        assertEquals(0, detailJson.path("version").asInt());
        assertTrue(detailJson.path("description").isNull());
        assertTrue(detailJson.path("levelId").isNull());
        assertTrue(detailJson.path("imageUrl").isNull());
        verify(service()).createRecommendation(new RecommendationDtos.SaveRequest("UP", "123", "Creator", null, List.of(1L), null, 3, "KEEP", null), null);

        final String remove = SAVE.replace("\"KEEP\"", "\"REMOVE\"").replace("\"expectedVersion\":null", "\"expectedVersion\":0");
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/recommendations/7").file(payload(remove)).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        verify(service()).updateRecommendation(7, new RecommendationDtos.SaveRequest("UP", "123", "Creator", null, List.of(1L), null, 3, "REMOVE", 0L), null);

        final MockMultipartFile avatar = new MockMultipartFile("image", "avatar.png", "image/png", new byte[] {1, 2, 3});
        mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE.replace("\"KEEP\"", "\"REPLACE\""))).file(avatar)
                        .with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated());
        verify(service()).createRecommendation(eq(new RecommendationDtos.SaveRequest("UP", "123", "Creator", null, List.of(1L), null, 3, "REPLACE", null)),
                any(MultipartFile.class));
        mvc.perform(delete("/api/admin/recommendations/7").queryParam("type", "UP").queryParam("expectedVersion", "1").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isNoContent());
        verify(service()).deleteRecommendation("UP", 7, 1);
    }

    @Test void twentyDigitStringUidPassesMultipartWithoutNumericCoercion() throws Exception {
        final String uid = "12345678901234567890";
        when(service().createRecommendation(any(), any())).thenReturn(new RecommendationDtos.Detail(7, 0, "UP", uid, "Creator", null, List.of(1L), null, 3, null));
        mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE.replace("\"123\"", "\"" + uid + "\"")))
                        .with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.externalId").isString())
                .andExpect(jsonPath("$.externalId").value(uid));
        verify(service()).createRecommendation(new RecommendationDtos.SaveRequest("UP", uid, "Creator", null, List.of(1L), null, 3, "KEEP", null), null);
    }

    @Test void multipartBoundaryRejectsMultipleImagesMissingPayloadAndJsonBody() throws Exception {
        final MockMultipartFile first = new MockMultipartFile("image", "a.png", "image/png", new byte[] {1});
        final MockMultipartFile second = new MockMultipartFile("image", "b.png", "image/png", new byte[] {2});
        mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE)).file(first).file(second).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isBadRequest());
        mvc.perform(multipart("/api/admin/recommendations").file(first).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
        mvc.perform(post("/api/admin/recommendations").contentType("application/json").content(SAVE).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isUnsupportedMediaType());
        verifyNoInteractions(service());
    }

    @Test void unknownSystemFieldsAndNonStringUidsAreRejectedByRealMultipartJacksonBinding() throws Exception {
        for (final String field : List.of("\"avatarId\":\"injected\"", "\"subject\":\"injected\"", "\"score\":10", "\"favoriteCount\":20")) {
            mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE.replace("\"name\":", field + ",\"name\":")))
                            .with(jwt().authorities(CONTENT_ADMIN)))
                    .andExpect(status().isBadRequest());
        }
        for (final String uid : List.of("123", "true")) {
            mvc.perform(multipart("/api/admin/recommendations").file(payload(SAVE.replace("\"externalId\":\"123\"", "\"externalId\":" + uid)))
                            .with(jwt().authorities(CONTENT_ADMIN)))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service());
    }

    @Test void exactNumbersRequiredNullableFieldsAndTwentyDigitUidAreEnforcedAtJacksonBoundary() {
        final var json = JsonMapper.builder().findAndAddModules().build();
        for (final String invalid : List.of(SAVE.replace("\"stars\":3", "\"stars\":3.2"),
                SAVE.replace("\"stars\":3", "\"stars\":\"3\""), SAVE.replace("\"stars\":3", "\"stars\":null"),
                SAVE.replace("\"categoryIds\":[1]", "\"categoryIds\":[\"1\"]"),
                SAVE.replace("\"levelId\":null,", ""), SAVE.replace("\"imageAction\":\"KEEP\"", "\"imageAction\":\"KEEP\",\"rewardPoints\":8"),
                SAVE.replace("\"externalId\":\"123\"", "\"externalId\":123"),
                SAVE.replace("\"externalId\":\"123\"", "\"externalId\":true"),
                SAVE.replace(",\"expectedVersion\":null", ""),
                SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":\"0\""),
                SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":0.5"),
                SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":true"))) {
            assertThrows(tools.jackson.core.JacksonException.class, () -> json.readValue(invalid, RecommendationDtos.SaveRequest.class));
        }
        final String uid = "12345678901234567890";
        assertEquals(uid, json.readValue(SAVE.replace("\"123\"", "\"" + uid + "\""), RecommendationDtos.SaveRequest.class).externalId());
        assertNull(json.readValue(SAVE, RecommendationDtos.SaveRequest.class).expectedVersion());
        assertEquals(0L, json.readValue(SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":0"), RecommendationDtos.SaveRequest.class).expectedVersion());
    }

    @Test void deleteRequiresAVersionQueryBeforeInvokingTheDirectory() throws Exception {
        mvc.perform(delete("/api/admin/recommendations/7").queryParam("type", "UP").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isBadRequest());
        for (final String version : List.of("1.5", "invalid")) {
            mvc.perform(delete("/api/admin/recommendations/7").queryParam("type", "UP").queryParam("expectedVersion", version).with(jwt().authorities(CONTENT_ADMIN)))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service());
        mvc.perform(delete("/api/admin/recommendations/7").queryParam("type", "UP").queryParam("expectedVersion", "2").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isNoContent());
        verify(service()).deleteRecommendation("UP", 7, 2);
    }

    @Test void retiredCreatorCatalogRoutesAreUnavailableWhileRecommendationLevelsRemainManaged() throws Exception {
        for (final String path : List.of("/api/creators", "/api/creators/categories")) {
            mvc.perform(get(path).with(jwt().authorities(CONTENT_ADMIN))).andExpect(status().isForbidden());
        }
        for (final String path : List.of("/api/admin/creators/metadata", "/api/admin/creators/7", "/api/admin/creators/levels/1")) {
            mvc.perform(get(path).with(jwt().authorities(CONTENT_ADMIN))).andExpect(status().isForbidden());
        }
        when(service().addLevel(any())).thenReturn(new RecommendationDtos.Level(2, "Expert"));
        mvc.perform(post("/api/admin/recommendations/levels").contentType("application/json")
                        .content("{\"name\":\"Expert\"}").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("Expert"));
        mvc.perform(delete("/api/admin/recommendations/levels/2").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isNoContent());
        verify(service()).addLevel(new RecommendationDtos.DictionaryRequest("Expert"));
        verify(service()).deleteLevel(2);
    }

    private static MockMultipartFile payload(final String json) {
        return new MockMultipartFile("payload", "", "application/json", json.getBytes(StandardCharsets.UTF_8));
    }
    private static RecommendationDtos.Detail detail() {
        return new RecommendationDtos.Detail(7, 0, "UP", "123", "Creator", null, List.of(1L), null, 3, null);
    }
    private CreatorService service() { return context.getBean(CreatorService.class); }
    private CreatorAvatarService avatars() { return context.getBean(CreatorAvatarService.class); }

    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean ReplayController healthController() { return new ReplayController(); }
        @Bean JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
        @Bean CreatorService service() { return mock(CreatorService.class); }
        @Bean CreatorAvatarService avatars() { return mock(CreatorAvatarService.class); }
        @Bean CreatorController publicController(final CreatorAvatarService avatars) {
            return new CreatorController(avatars);
        }
        @Bean RecommendationController recommendationController(final CreatorService service) { return new RecommendationController(service); }
    }
}
