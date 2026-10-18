package com.wotb.web.creator;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.creator.controller.CreatorAdminController;
import com.wotb.web.creator.controller.CreatorController;
import com.wotb.web.creator.dto.CreatorDtos;
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
            {"bilibiliUid":"123","name":"Creator","description":null,
             "categoryIds":[1],"levelId":null,"stars":3,"avatarAction":"KEEP","expectedVersion":null}
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

    @Test void anonymousHealthAdvertisesContentVisibilityWithoutReadingTheCreatorDirectory() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.tanks").isNumber())
                .andExpect(jsonPath("$.capabilities[0]").value("creators-v1"))
                .andExpect(jsonPath("$.capabilities[1]").value("creators-content-visibility-v1"))
                .andExpect(jsonPath("$.capabilities[2]").value("recommendations-v1"));
        verifyNoInteractions(service(), avatars());
    }

    @Test void publicDirectoryAndAttachedAvatarAreAnonymousWhileMetadataIsAdministrative() throws Exception {
        when(service().list(null)).thenReturn(List.of());
        when(service().publicCategories()).thenReturn(List.of(new CreatorDtos.Category(1, "Category")));
        final String avatarId = "11111111-1111-4111-8111-111111111111";
        when(avatars().load(avatarId)).thenReturn(new CreatorAvatarService.AvatarImage(new byte[] {1, 2}, "image/png", "a".repeat(64)));
        mvc.perform(get("/api/creators")).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mvc.perform(get("/api/creators/categories")).andExpect(status().isOk()).andExpect(jsonPath("$[0].name").value("Category"));
        mvc.perform(get("/api/creators/avatars/" + avatarId)).andExpect(status().isOk())
                .andExpect(content().contentType("image/png")).andExpect(content().bytes(new byte[] {1, 2}))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(get("/api/admin/creators/metadata")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/creators").with(jwt().authorities())).andExpect(status().isForbidden());
    }

    @Test void metadataAndEditableDetailsRequireTheRealContentRoleOrItsComposite() throws Exception {
        when(service().metadata()).thenReturn(new CreatorDtos.Metadata(
                List.of(new CreatorDtos.Category(1, "A")), List.of(new CreatorDtos.Level(1, "Expert")), false));
        when(service().detail(7)).thenReturn(detail());
        for (final String path : List.of("/api/admin/creators/7", "/api/admin/creators/metadata")) {
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
        mvc.perform(get("/api/admin/creators/metadata").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(jsonPath("$.categories[0].id").value(1)).andExpect(jsonPath("$.levels[0].name").value("Expert"))
                .andExpect(jsonPath("$.avatarUploadsAvailable").value(false));
    }

    @Test void ordinaryUsersCannotSaveRemoveOrMaintainDictionaryEntries() throws Exception {
        mvc.perform(multipart("/api/admin/creators").file(payload(SAVE))).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/admin/creators").file(payload(SAVE)).with(jwt().authorities())).andExpect(status().isForbidden());
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/creators/7").file(payload(SAVE)).with(jwt().authorities()))
                .andExpect(status().isForbidden());
        for (final String path : List.of("/api/admin/creators/7", "/api/admin/creators/categories/1", "/api/admin/creators/levels/1")) {
            mvc.perform(delete(path)).andExpect(status().isUnauthorized());
            mvc.perform(delete(path).with(jwt().authorities())).andExpect(status().isForbidden());
        }
        for (final String path : List.of("/api/admin/creators/categories", "/api/admin/creators/levels")) {
            mvc.perform(post(path).contentType("application/json").content("{\"name\":\"New\"}").with(jwt().authorities()))
                    .andExpect(status().isForbidden());
        }
        // Content writes are owned by content-admin: the tournament role is not a compatibility fallback.
        final SimpleGrantedAuthority tournament = new SimpleGrantedAuthority("ROLE_tournament-admin");
        mvc.perform(multipart("/api/admin/creators").file(payload(SAVE)).with(jwt().authorities(tournament)))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/creators/7").queryParam("expectedVersion", "1").with(jwt().authorities(tournament)))
                .andExpect(status().isForbidden());
        verifyNoInteractions(service());
    }

    @Test void cardSerializationKeepsExactUidAndExplicitNullsWithoutPrivateOrEditableState() throws Exception {
        final String uid = "12345678901234567890";
        final CreatorDtos.Card card = new CreatorDtos.Card(7, 2, uid, "Creator", null, "https://space.bilibili.com/" + uid, null,
                List.of(new CreatorDtos.Category(1, "A"), new CreatorDtos.Category(2, "B")), null, 6, Instant.parse("2026-10-16T00:00:00Z"));
        when(service().list(1L)).thenReturn(List.of(card));
        final String json = mvc.perform(get("/api/creators?categoryId=1")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].bilibiliUid").isString()).andExpect(jsonPath("$[0].bilibiliUid").value(uid))
                .andExpect(jsonPath("$[0].score").value(6))
                .andExpect(jsonPath("$[0].version").value(2))
                .andExpect(jsonPath("$[0].categories.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        final var node = JsonMapper.builder().findAndAddModules().build().readTree(json).get(0);
        assertEquals(11, node.properties().size());
        assertEquals(uid, node.path("bilibiliUid").asText());
        assertTrue(node.path("description").isNull());
        assertTrue(node.path("avatarUrl").isNull());
        assertTrue(node.path("level").isNull());
        assertFalse(node.has("stars"));
        assertFalse(node.has("avatarId"));
        assertFalse(node.has("subject"));
        assertFalse(node.has("favoriteCount"));
    }

    @Test void multipartSaveBindsKeepRemoveAndReplacementWithDeclaredStatuses() throws Exception {
        when(service().create(any(), any())).thenReturn(detail());
        when(service().update(eq(7L), any(), any())).thenReturn(new CreatorDtos.Detail(7, 1, "123", "Creator", null, List.of(1L), null, 3, null));
        final String createdJson = mvc.perform(multipart("/api/admin/creators").file(payload(SAVE)).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.id").value(7)).andExpect(jsonPath("$.stars").value(3))
                .andExpect(jsonPath("$.avatarId").doesNotExist()).andExpect(jsonPath("$.homepageUrl").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        final var detailJson = JsonMapper.builder().findAndAddModules().build().readTree(createdJson);
        assertEquals(9, detailJson.properties().size());
        assertEquals(0, detailJson.path("version").asInt());
        assertTrue(detailJson.path("description").isNull());
        assertTrue(detailJson.path("levelId").isNull());
        assertTrue(detailJson.path("avatarUrl").isNull());
        verify(service()).create(new CreatorDtos.SaveRequest("123", "Creator", null, List.of(1L), null, 3, "KEEP", null), null);

        final String remove = SAVE.replace("\"KEEP\"", "\"REMOVE\"").replace("\"expectedVersion\":null", "\"expectedVersion\":0");
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/creators/7").file(payload(remove)).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        verify(service()).update(7, new CreatorDtos.SaveRequest("123", "Creator", null, List.of(1L), null, 3, "REMOVE", 0L), null);

        final MockMultipartFile avatar = new MockMultipartFile("avatar", "avatar.png", "image/png", new byte[] {1, 2, 3});
        mvc.perform(multipart("/api/admin/creators").file(payload(SAVE.replace("\"KEEP\"", "\"REPLACE\""))).file(avatar)
                        .with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated());
        verify(service()).create(eq(new CreatorDtos.SaveRequest("123", "Creator", null, List.of(1L), null, 3, "REPLACE", null)),
                any(MultipartFile.class));
        mvc.perform(delete("/api/admin/creators/7").queryParam("expectedVersion", "1").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isNoContent());
        verify(service()).delete(7, 1);
    }

    @Test void twentyDigitStringUidPassesMultipartWithoutNumericCoercion() throws Exception {
        final String uid = "12345678901234567890";
        when(service().create(any(), any())).thenReturn(new CreatorDtos.Detail(7, 0, uid, "Creator", null, List.of(1L), null, 3, null));
        mvc.perform(multipart("/api/admin/creators").file(payload(SAVE.replace("\"123\"", "\"" + uid + "\"")))
                        .with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.bilibiliUid").isString())
                .andExpect(jsonPath("$.bilibiliUid").value(uid));
        verify(service()).create(new CreatorDtos.SaveRequest(uid, "Creator", null, List.of(1L), null, 3, "KEEP", null), null);
    }

    @Test void multipartBoundaryRejectsMultipleAvatarsMissingPayloadAndLegacyJsonBody() throws Exception {
        final MockMultipartFile first = new MockMultipartFile("avatar", "a.png", "image/png", new byte[] {1});
        final MockMultipartFile second = new MockMultipartFile("avatar", "b.png", "image/png", new byte[] {2});
        mvc.perform(multipart("/api/admin/creators").file(payload(SAVE)).file(first).file(second).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isBadRequest());
        mvc.perform(multipart("/api/admin/creators").file(first).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"));
        mvc.perform(post("/api/admin/creators").contentType("application/json").content(SAVE).with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isUnsupportedMediaType());
        verifyNoInteractions(service());
    }

    @Test void unknownSystemFieldsAndNonStringUidsAreRejectedByRealMultipartJacksonBinding() throws Exception {
        for (final String field : List.of("\"avatarId\":\"injected\"", "\"subject\":\"injected\"", "\"score\":10", "\"favoriteCount\":20")) {
            mvc.perform(multipart("/api/admin/creators").file(payload(SAVE.replace("\"name\":", field + ",\"name\":")))
                            .with(jwt().authorities(CONTENT_ADMIN)))
                    .andExpect(status().isBadRequest());
        }
        for (final String uid : List.of("123", "true")) {
            mvc.perform(multipart("/api/admin/creators").file(payload(SAVE.replace("\"bilibiliUid\":\"123\"", "\"bilibiliUid\":" + uid)))
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
                SAVE.replace("\"levelId\":null,", ""), SAVE.replace("\"avatarAction\":\"KEEP\"", "\"avatarAction\":\"KEEP\",\"rewardPoints\":8"),
                SAVE.replace("\"bilibiliUid\":\"123\"", "\"bilibiliUid\":123"),
                SAVE.replace("\"bilibiliUid\":\"123\"", "\"bilibiliUid\":true"),
                SAVE.replace(",\"expectedVersion\":null", ""),
                SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":\"0\""),
                SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":0.5"),
                SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":true"))) {
            assertThrows(tools.jackson.core.JacksonException.class, () -> json.readValue(invalid, CreatorDtos.SaveRequest.class));
        }
        final String uid = "12345678901234567890";
        assertEquals(uid, json.readValue(SAVE.replace("\"123\"", "\"" + uid + "\""), CreatorDtos.SaveRequest.class).bilibiliUid());
        assertNull(json.readValue(SAVE, CreatorDtos.SaveRequest.class).expectedVersion());
        assertEquals(0L, json.readValue(SAVE.replace("\"expectedVersion\":null", "\"expectedVersion\":0"), CreatorDtos.SaveRequest.class).expectedVersion());
    }

    @Test void deleteRequiresAVersionQueryBeforeInvokingTheDirectory() throws Exception {
        mvc.perform(delete("/api/admin/creators/7").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isBadRequest());
        for (final String version : List.of("1.5", "invalid")) {
            mvc.perform(delete("/api/admin/creators/7").queryParam("expectedVersion", version).with(jwt().authorities(CONTENT_ADMIN)))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service());
        mvc.perform(delete("/api/admin/creators/7").queryParam("expectedVersion", "2").with(jwt().authorities(CONTENT_ADMIN)))
                .andExpect(status().isNoContent());
        verify(service()).delete(7, 2);
    }

    private static MockMultipartFile payload(final String json) {
        return new MockMultipartFile("payload", "", "application/json", json.getBytes(StandardCharsets.UTF_8));
    }
    private static CreatorDtos.Detail detail() {
        return new CreatorDtos.Detail(7, 0, "123", "Creator", null, List.of(1L), null, 3, null);
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
        @Bean CreatorController publicController(final CreatorService service, final CreatorAvatarService avatars) {
            return new CreatorController(service, avatars);
        }
        @Bean CreatorAdminController adminController(final CreatorService service) { return new CreatorAdminController(service); }
    }
}
