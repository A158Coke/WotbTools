package com.wotb.web.tournament;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.tournament.controller.BroadcastAdminController;
import com.wotb.web.tournament.controller.BroadcastController;
import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.service.BroadcastCoverService;
import com.wotb.web.tournament.service.BroadcastService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BroadcastHttpTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    @BeforeEach void setup() {
        context = new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext());
        context.register(TestConfig.class); context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    @AfterEach void close() { context.close(); }
    @Test void anonymousReadsAndRealGlobalAdministratorAreTheOnlyAccessPaths() throws Exception {
        final BroadcastService service = context.getBean(BroadcastService.class);
        when(service.index(null)).thenReturn(new BroadcastDtos.Index(List.of("CN","ASIA","NA","EU","LESTA"), List.of(), false));
        mvc.perform(get("/api/tournament-broadcasts")).andExpect(status().isOk())
                .andExpect(jsonPath("$.servers[4]").value("LESTA"));
        mvc.perform(get("/api/admin/tournament-broadcasts/seasons/1/deletion-preview")).andExpect(status().isUnauthorized());
        for (final String role : List.of("tournament-admin", "HoF-admin", "wotbtools-user")) {
            mvc.perform(get("/api/admin/tournament-broadcasts/seasons/1/deletion-preview")
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role)))).andExpect(status().isForbidden());
        }
        when(service.seasonDeletionPreview(1)).thenReturn(new BroadcastDtos.DeletionPreview(1, 2, 3, 4));
        mvc.perform(get("/api/admin/tournament-broadcasts/seasons/1/deletion-preview")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.expectedVersion").value(2));
        mvc.perform(post("/api/tournament-broadcasts").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/tournament-broadcasts/seasons/1/deletion-preview")).andExpect(status().isUnauthorized());
    }
    @Test void categorySerializationPreservesExplicitNullsDatesAndOrderedTeams() throws Exception {
        final BroadcastDtos.Replay replay = new BroadcastDtos.Replay(4, 3, "Title", "https://example.org/replay",
                LocalDate.of(2026, 10, 16), 9, "Group 12", null, null, List.of("Followed","Other"), "OBSERVER", null);
        final BroadcastDtos.CategoryView view = new BroadcastDtos.CategoryView(season(),
                new BroadcastDtos.Category(2, 1, "POINTS"), List.of(new BroadcastDtos.Node(3,2,5,null,List.of(replay))), false);
        when(context.getBean(BroadcastService.class).category(2)).thenReturn(view);
        final String json = mvc.perform(get("/api/tournament-broadcasts/categories/2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.season.startDate").value(nullValue()))
                .andExpect(jsonPath("$.nodes[0].format").value(nullValue()))
                .andExpect(jsonPath("$.nodes[0].replays[0].matchDate").value("2026-10-16"))
                .andExpect(jsonPath("$.nodes[0].replays[0].teams[0]").value("Followed"))
                .andExpect(jsonPath("$.nodes[0].replays[0].coverId").value(nullValue())).andReturn().getResponse().getContentAsString();
        final var tree = new JsonMapper().readTree(json);
        assertTrue(tree.get("season").has("startDate"));
        assertTrue(tree.get("nodes").get(0).get("replays").get(0).has("groupNumber"));
    }
    @Test void malformedRequiredIntegersCannotDefaultOrTruncateBeforeReachingService() throws Exception {
        for (final String body : List.of(
                "{\"server\":\"CN\",\"name\":\"Summer\",\"startDate\":null}",
                "{\"server\":\"CN\",\"year\":null,\"name\":\"Summer\",\"startDate\":null}",
                "{\"server\":\"CN\",\"year\":2026.5,\"name\":\"Summer\",\"startDate\":null}",
                "{\"server\":\"CN\",\"year\":\"2026\",\"name\":\"Summer\",\"startDate\":null}")) {
            mvc.perform(post("/api/admin/tournament-broadcasts/seasons")
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(context.getBean(BroadcastService.class));
    }
    @Test void multipartJsonUsesTheSameStrictDtoForCreateAndUpdate() throws Exception {
        final String json = "{\"expectedVersion\":2,\"title\":\"Title\",\"url\":\"https://example.org/replay\",\"matchDate\":\"2026-10-16\",\"dayNumber\":9,\"groupLabel\":\"Group 12\",\"groupNumber\":null,\"bracket\":null,\"teams\":[\"Followed\",\"Other\"],\"perspective\":\"POV\",\"coverAction\":\"KEEP\"}";
        final MockMultipartFile payload = new MockMultipartFile("payload", "", "application/json", json.getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/tournament-broadcasts/replays/4").file(payload)
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastDtos.ReplaySave> request = ArgumentCaptor.forClass(BroadcastDtos.ReplaySave.class);
        verify(context.getBean(BroadcastService.class)).updateReplay(eq(4L), request.capture(), eq(null));
        assertEquals(LocalDate.of(2026,10,16), request.getValue().matchDate()); assertEquals(9, request.getValue().dayNumber());
        final MockMultipartFile malformed = new MockMultipartFile("payload", "", "application/json",
                json.replace("\"dayNumber\":9", "\"dayNumber\":2.5").getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/admin/tournament-broadcasts/nodes/3/replays").file(malformed)
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isBadRequest());
    }
    @Test void deleteRequiresExplicitConfirmationAndVersionAndReturnsNoContent() throws Exception {
        mvc.perform(delete("/api/admin/tournament-broadcasts/replays/4?expectedVersion=2")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/admin/tournament-broadcasts/replays/4?expectedVersion=2&confirm=true")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isNoContent());
        verify(context.getBean(BroadcastService.class)).deleteReplay(4,2,true);
    }
    @Test void unknownRequestFieldsCannotOverrideInheritedIdentityOrNodeConfiguration() throws Exception {
        mvc.perform(post("/api/admin/tournament-broadcasts/seasons")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                .contentType("application/json")
                .content("{\"server\":\"CN\",\"year\":2026,\"name\":\"Summer\",\"startDate\":null,\"serverOverride\":\"LESTA\"}"))
                .andExpect(status().isBadRequest());
        final String replay = "{\"expectedVersion\":2,\"title\":\"Title\",\"url\":\"https://example.org/replay\",\"matchDate\":\"2026-10-16\",\"dayNumber\":9,\"groupLabel\":\"Group 12\",\"groupNumber\":null,\"bracket\":null,\"teams\":[\"Followed\",\"Other\"],\"perspective\":\"POV\",\"coverAction\":\"KEEP\"";
        for (final String extra : List.of("\"nodeId\":42", "\"roundNumber\":4", "\"format\":\"KNOCKOUT\"")) {
            final MockMultipartFile payload = new MockMultipartFile("payload","","application/json",
                    (replay + "," + extra + "}").getBytes(StandardCharsets.UTF_8));
            mvc.perform(multipart("/api/admin/tournament-broadcasts/nodes/3/replays").file(payload)
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(context.getBean(BroadcastService.class));
    }
    @Test void publicCoverHasSafeMimeAndCacheHeaders() throws Exception {
        when(context.getBean(BroadcastCoverService.class).load("cover")).thenReturn(
                new BroadcastCoverService.CoverImage(new byte[]{1,2,3}, "image/png", "a".repeat(64)));
        mvc.perform(get("/api/tournament-broadcasts/covers/cover")).andExpect(status().isOk())
                .andExpect(header().string("Content-Type","image/png"))
                .andExpect(header().string("X-Content-Type-Options","nosniff"))
                .andExpect(header().string("ETag", "\"" + "a".repeat(64) + "\""));
    }
    private static BroadcastDtos.Season season() {
        return new BroadcastDtos.Season(1,"LESTA",2026,"Summer",null,Instant.parse("2026-10-16T00:00:00Z"),2,1,1);
    }
    @Configuration @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
        @Bean BroadcastService service() { return mock(BroadcastService.class); }
        @Bean BroadcastCoverService covers() { return mock(BroadcastCoverService.class); }
        @Bean BroadcastController publicController(final BroadcastService service, final BroadcastCoverService covers) { return new BroadcastController(service,covers); }
        @Bean BroadcastAdminController adminController(final BroadcastService service) { return new BroadcastAdminController(service); }
    }
}
