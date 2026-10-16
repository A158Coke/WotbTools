package com.wotb.web.creator;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.creator.controller.CreatorAdminController;
import com.wotb.web.creator.controller.CreatorController;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CreatorHttpTest {
    private static final String SAVE = """
            {"name":"Creator","description":null,"homepageUrl":"https://space.bilibili.com/123",
             "categoryIds":[1],"levelId":null,"baseStars":3,"avatarId":null}
            """;
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

    @Test void publicCatalogIsAnonymousButPersonalStateRequiresAnyAuthenticatedUser() throws Exception {
        when(service().list(null)).thenReturn(List.of());
        when(service().categories()).thenReturn(List.of(new CreatorDtos.Category(1, "Category")));
        mvc.perform(get("/api/creators")).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        mvc.perform(get("/api/creators/categories")).andExpect(status().isOk());
        mvc.perform(get("/api/creators/favorites")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"));
        mvc.perform(put("/api/creators/1/favorite")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/creators/1/favorite")).andExpect(status().isUnauthorized());
        when(service().favorites("normal-user")).thenReturn(new CreatorDtos.Favorites(List.of(1L)));
        mvc.perform(get("/api/creators/favorites").with(jwt().jwt(token -> token.subject("normal-user")).authorities()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.creatorIds[0]").value(1));
        mvc.perform(put("/api/creators/1/favorite").with(jwt().jwt(token -> token.subject("normal-user")).authorities()))
                .andExpect(status().isOk());
        verify(service()).favorite("normal-user", 1, true);
        mvc.perform(delete("/api/creators/1/favorite").with(jwt().jwt(token -> token.subject("normal-user")).authorities()))
                .andExpect(status().isOk());
        verify(service()).favorite("normal-user", 1, false);
        mvc.perform(post("/api/creators").with(jwt())).andExpect(status().isForbidden());
    }
    @Test void everyManagementRouteRequiresTournamentRoleAndCompositeContainsThatRole() throws Exception {
        for (final String path : List.of("/api/admin/creators/1", "/api/admin/creators/categories",
                "/api/admin/creators/levels", "/api/admin/creators/settings")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).with(jwt().authorities())).andExpect(status().isForbidden());
            mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin")))).andExpect(status().isForbidden());
            mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isForbidden());
            mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isOk());
            mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"),
                    new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        }
        mvc.perform(post("/api/admin/creators").contentType("application/json").content(SAVE).with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/admin/creators/1").contentType("application/json").content(SAVE).with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/creators/1").with(jwt().authorities())).andExpect(status().isForbidden());
    }
    @Test void cardSerializationPreservesExplicitNullsAndHidesAdminAndPersonalHistory() throws Exception {
        final CreatorDtos.Card card = new CreatorDtos.Card(7, "Creator", null, "https://space.bilibili.com/123", null,
                List.of(new CreatorDtos.Category(1, "A"), new CreatorDtos.Category(2, "B")), null, 7, 200, Instant.parse("2026-10-16T00:00:00Z"));
        when(service().list(1L)).thenReturn(List.of(card));
        final String json = mvc.perform(get("/api/creators?categoryId=1")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].score").value(7)).andExpect(jsonPath("$[0].categories.length()").value(2))
                .andExpect(jsonPath("$[0].baseStars").doesNotExist()).andExpect(jsonPath("$[0].subject").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        final var node = JsonMapper.builder().findAndAddModules().build().readTree(json).get(0);
        assertEquals(10, node.properties().size());
        assertEquals(true, node.has("description"));
        assertEquals(true, node.path("description").isNull());
        assertEquals(true, node.path("avatarUrl").isNull());
        assertEquals(true, node.path("level").isNull());
    }
    @Test void createsAndDeletesUseDeclaredStatusesAndRejectSystemFieldInjection() throws Exception {
        final CreatorDtos.Detail detail = new CreatorDtos.Detail(1, "Creator", null, "https://space.bilibili.com/123", List.of(1L), null, 3, null, null);
        when(service().create(any())).thenReturn(detail);
        mvc.perform(post("/api/admin/creators").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))
                .contentType("application/json").content(SAVE)).andExpect(status().isCreated()).andExpect(jsonPath("$.id").value(1));
        mvc.perform(delete("/api/admin/creators/1").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isNoContent());
        final String injected = SAVE.replace("\"name\":", "\"favoriteCount\":100,\"name\":");
        mvc.perform(post("/api/admin/creators").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))
                .contentType("application/json").content(injected)).andExpect(status().isBadRequest());
    }
    @Test void exactNumbersAndRequiredNullableFieldsAreEnforcedAtJacksonBoundary() {
        final var json = JsonMapper.builder().findAndAddModules().build();
        for (final String invalid : List.of(SAVE.replace("\"baseStars\":3", "\"baseStars\":3.2"),
                SAVE.replace("\"baseStars\":3", "\"baseStars\":\"3\""),
                SAVE.replace("\"baseStars\":3", "\"baseStars\":null"),
                SAVE.replace("\"categoryIds\":[1]", "\"categoryIds\":[\"1\"]"),
                SAVE.replace("\"levelId\":null,", ""),
                SAVE.replace("\"avatarId\":null", "\"score\":10,\"avatarId\":null"))) {
            assertThrows(tools.jackson.core.JacksonException.class, () -> json.readValue(invalid, CreatorDtos.SaveRequest.class));
        }
        assertThrows(tools.jackson.core.JacksonException.class, () -> json.readValue("{\"favoriteThreshold\":1.1}", CreatorDtos.SettingsRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class, () -> json.readValue("{\"favoriteThreshold\":\"1\"}", CreatorDtos.SettingsRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class, () -> json.readValue("{\"favoriteThreshold\":null}", CreatorDtos.SettingsRequest.class));
    }
    private CreatorService service() { return context.getBean(CreatorService.class); }
    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
        @Bean CreatorService service() { return mock(CreatorService.class); }
        @Bean CreatorController publicController(final CreatorService service) { return new CreatorController(service); }
        @Bean CreatorAdminController adminController(final CreatorService service) { return new CreatorAdminController(service); }
    }
}
