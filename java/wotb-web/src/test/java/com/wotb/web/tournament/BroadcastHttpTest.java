package com.wotb.web.tournament;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.tournament.controller.BroadcastAdminController;
import com.wotb.web.tournament.controller.BroadcastController;
import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.dto.BroadcastLegacyDtos;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
    @Test void v3EnvelopeSerializesOnlyKnownTimesWithoutChangingV2Body() throws Exception {
        final var replay = new BroadcastDtos.Replay(4,3,"Title","https://example.org/replay",LocalDate.of(2026,10,16),1,null,null,List.of("A","B"),"OBSERVER",null);
        final var data = new BroadcastDtos.CategoryView(season(),new BroadcastDtos.Category(2,1,"POINTS"),List.of(new BroadcastDtos.Node(3,2,1,null,List.of(replay))),false);
        final var timed = new BroadcastDtos.TimedCategoryView(data,"Europe/Moscow",List.of(new BroadcastDtos.ReplayStart(4,Instant.parse("2026-10-16T16:00:00Z"))));
        when(context.getBean(BroadcastService.class).timedCategory(2)).thenReturn(timed);
        mvc.perform(get("/api/tournament-broadcasts/v3/categories/2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.defaultTimeZone").value("Europe/Moscow"))
                .andExpect(jsonPath("$.replayStarts[0].startsAt").value("2026-10-16T16:00:00Z"))
                .andExpect(jsonPath("$.data.nodes[0].replays[0].startsAt").doesNotExist())
                .andExpect(jsonPath("$.data.nodes[0].replays[0].groupNumber").value(nullValue()));
        when(context.getBean(BroadcastService.class).category(2)).thenReturn(data);
        final String old = mvc.perform(get("/api/tournament-broadcasts/v2/categories/2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.defaultTimeZone").doesNotExist()).andReturn().getResponse().getContentAsString();
        assertEquals(4,new JsonMapper().readTree(old).properties().size());
        mvc.perform(get("/api/tournament-broadcasts/v3/categories/2/other")).andExpect(status().isUnauthorized());
    }
    @Test void v3MultipartRequiresExplicitTimeAndRetainsAdministratorAuthorization() throws Exception {
        final var replay = new BroadcastDtos.ReplaySave(2,"Title","https://example.org/replay",LocalDate.of(2026,10,16),1,null,null,List.of("A","B"),"OBSERVER","KEEP");
        final String body = new JsonMapper().writeValueAsString(new BroadcastDtos.TimedReplaySave(replay,null));
        final MockMultipartFile payload = new MockMultipartFile("payload","","application/json",body.getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/admin/tournament-broadcasts/v3/nodes/3/replays").file(payload)).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/admin/tournament-broadcasts/v3/nodes/3/replays").file(payload)
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isForbidden());
        mvc.perform(multipart("/api/admin/tournament-broadcasts/v3/nodes/3/replays").file(payload)
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastDtos.TimedReplaySave> saved = ArgumentCaptor.forClass(BroadcastDtos.TimedReplaySave.class);
        verify(context.getBean(BroadcastService.class)).timedCreateReplay(eq(3L),saved.capture(),eq(null));
        assertEquals(null,saved.getValue().startsAt()); assertEquals(null,saved.getValue().replay().groupNumber());
        for (final String invalid : List.of(body.replace("\"startsAt\":null","\"startsAt\":123"),body.replace("\"startsAt\":null","\"startsAt\":\"\""),body.replace(",\"startsAt\":null",""),body.replace("\"startsAt\":null","\"startsAt\":\"2026-10-16\""),body.replace("\"startsAt\":null","\"startsAt\":null,\"extra\":true"))) {
            mvc.perform(multipart(HttpMethod.PUT,"/api/admin/tournament-broadcasts/v3/replays/4")
                    .file(new MockMultipartFile("payload","","application/json",invalid.getBytes(StandardCharsets.UTF_8)))
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isBadRequest());
        }
        final String offsetBody = body.replace("\"startsAt\":null","\"startsAt\":\"2026-10-16T19:00:00+03:00\"");
        mvc.perform(multipart(HttpMethod.PUT,"/api/admin/tournament-broadcasts/v3/replays/4")
                .file(new MockMultipartFile("payload","","application/json",offsetBody.getBytes(StandardCharsets.UTF_8)))
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastDtos.TimedReplaySave> updated = ArgumentCaptor.forClass(BroadcastDtos.TimedReplaySave.class);
        verify(context.getBean(BroadcastService.class)).timedUpdateReplay(eq(4L),updated.capture(),eq(null));
        assertEquals(Instant.parse("2026-10-16T16:00:00Z"),updated.getValue().startsAt());
        mvc.perform(post("/api/admin/tournament-broadcasts/v3/categories/2/nodes").contentType("application/json")
                .content("{\"expectedVersion\":2,\"roundNumber\":1,\"format\":null}")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        verify(context.getBean(BroadcastService.class)).timedCreateNode(2,new BroadcastDtos.NodeCreate(2,1,null));
    }
    @Test void anonymousReadsAndRealGlobalAdministratorAreTheOnlyAccessPaths() throws Exception {
        final BroadcastService service = context.getBean(BroadcastService.class);
        when(service.index(null)).thenReturn(new BroadcastDtos.Index(List.of("CN","ASIA","NA","EU","LESTA"), List.of(), false));
        mvc.perform(get("/api/tournament-broadcasts/v2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.servers[4]").value("LESTA"));
        mvc.perform(get("/api/admin/tournament-broadcasts/v2/seasons/1/deletion-preview")).andExpect(status().isUnauthorized());
        for (final String role : List.of("tournament-admin", "HoF-admin", "wotbtools-user")) {
            mvc.perform(get("/api/admin/tournament-broadcasts/v2/seasons/1/deletion-preview")
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role)))).andExpect(status().isForbidden());
        }
        when(service.seasonDeletionPreview(1)).thenReturn(new BroadcastDtos.DeletionPreview(1, 2, 3, 4));
        mvc.perform(get("/api/admin/tournament-broadcasts/v2/seasons/1/deletion-preview")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.expectedVersion").value(2));
        mvc.perform(post("/api/tournament-broadcasts/v2").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/tournament-broadcasts/v2/seasons/1/deletion-preview")).andExpect(status().isUnauthorized());
    }
    @Test void originalWireAndWriteRequestsRemainClosedAndAvailableToOldClients() throws Exception {
        final BroadcastService service = context.getBean(BroadcastService.class);
        final BroadcastLegacyDtos.Season season = new BroadcastLegacyDtos.Season(1,"LESTA",2026,"Summer",null,Instant.parse("2026-10-16T00:00:00Z"),2,1,1);
        final BroadcastLegacyDtos.Replay replay = new BroadcastLegacyDtos.Replay(4,3,"Title","https://example.org/replay",LocalDate.of(2026,10,16),9,"42",null,null,List.of("A","B"),"POV",null);
        final BroadcastLegacyDtos.CategoryView category = new BroadcastLegacyDtos.CategoryView(season,new BroadcastDtos.Category(2,1,"POINTS"),List.of(new BroadcastLegacyDtos.Node(3,2,1,null,List.of(replay))),false);
        when(service.legacyIndex(null)).thenReturn(new BroadcastLegacyDtos.Index(List.of("CN","ASIA","NA","EU","LESTA"),List.of(season),false));
        when(service.legacySeason(1)).thenReturn(new BroadcastLegacyDtos.SeasonView(season,List.of(),false)); when(service.legacyCategory(2)).thenReturn(category);
        mvc.perform(get("/api/tournament-broadcasts")).andExpect(status().isOk()).andExpect(jsonPath("$.seasons[0].name").value("Summer"));
        mvc.perform(get("/api/tournament-broadcasts/seasons/1")).andExpect(status().isOk()).andExpect(jsonPath("$.season.name").value("Summer"));
        final String json = mvc.perform(get("/api/tournament-broadcasts/categories/2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.season.name").value("Summer")).andExpect(jsonPath("$.season.nameZh").doesNotExist())
                .andExpect(jsonPath("$.nodes[0].replays[0].groupLabel").value("42"))
                .andExpect(jsonPath("$.nodes[0].replays[0].groupNumber").value(nullValue())).andReturn().getResponse().getContentAsString();
        final var tree = new JsonMapper().readTree(json);
        assertEquals(9,tree.get("season").properties().size()); assertEquals(12,tree.get("nodes").get(0).get("replays").get(0).properties().size());
        final String create = "{\"server\":\"CN\",\"year\":2026,\"name\":\"Summer\",\"startDate\":null}";
        mvc.perform(post("/api/admin/tournament-broadcasts/seasons").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                .contentType("application/json").content(create)).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastLegacyDtos.SeasonCreate> created = ArgumentCaptor.forClass(BroadcastLegacyDtos.SeasonCreate.class);
        verify(service).legacyCreateSeason(created.capture()); assertEquals("Summer",created.getValue().name());
        final String payload = "{\"expectedVersion\":2,\"title\":\"Title\",\"url\":\"https://example.org/replay\",\"matchDate\":\"2026-10-16\",\"dayNumber\":9,\"groupLabel\":\"42\",\"groupNumber\":null,\"bracket\":null,\"teams\":[\"A\",\"B\"],\"perspective\":\"POV\",\"coverAction\":\"KEEP\"}";
        mvc.perform(multipart("/api/admin/tournament-broadcasts/nodes/3/replays")
                .file(new MockMultipartFile("payload","","application/json",payload.getBytes(StandardCharsets.UTF_8)))
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastLegacyDtos.ReplaySave> saved = ArgumentCaptor.forClass(BroadcastLegacyDtos.ReplaySave.class);
        verify(service).legacyCreateReplay(eq(3L),saved.capture(),eq(null)); assertEquals("42",saved.getValue().groupLabel());
        for (final String prefix : List.of("/api/admin/tournament-broadcasts","/api/admin/tournament-broadcasts/v2")) {
            mvc.perform(get(prefix+"/seasons/1/deletion-preview")).andExpect(status().isUnauthorized());
            mvc.perform(get(prefix+"/seasons/1/deletion-preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                    .andExpect(status().isForbidden());
        }
    }
    @Test void categorySerializationPreservesExplicitNullsDatesAndOrderedTeams() throws Exception {
        final BroadcastDtos.Replay replay = new BroadcastDtos.Replay(4, 3, "Title", "https://example.org/replay",
                LocalDate.of(2026, 10, 16), 9, 12, null, List.of("Followed","Other"), "OBSERVER", null);
        final BroadcastDtos.CategoryView view = new BroadcastDtos.CategoryView(season(),
                new BroadcastDtos.Category(2, 1, "POINTS"), List.of(new BroadcastDtos.Node(3,2,5,null,List.of(replay))), false);
        when(context.getBean(BroadcastService.class).category(2)).thenReturn(view);
        final String json = mvc.perform(get("/api/tournament-broadcasts/v2/categories/2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.season.nameZh").value("夏季赛"))
                .andExpect(jsonPath("$.season.nameEn").value("Summer"))
                .andExpect(jsonPath("$.season.nameRu").value(nullValue()))
                .andExpect(jsonPath("$.season.name").doesNotExist())
                .andExpect(jsonPath("$.season.startDate").value(nullValue()))
                .andExpect(jsonPath("$.nodes[0].format").value(nullValue()))
                .andExpect(jsonPath("$.nodes[0].replays[0].groupNumber").value(12))
                .andExpect(jsonPath("$.nodes[0].replays[0].groupLabel").doesNotExist())
                .andExpect(jsonPath("$.nodes[0].replays[0].matchDate").value("2026-10-16"))
                .andExpect(jsonPath("$.nodes[0].replays[0].teams[0]").value("Followed"))
                .andExpect(jsonPath("$.nodes[0].replays[0].coverId").value(nullValue())).andReturn().getResponse().getContentAsString();
        final var tree = new JsonMapper().readTree(json);
        assertTrue(tree.get("season").has("startDate"));
        assertTrue(tree.get("season").has("nameRu"));
        assertTrue(tree.get("nodes").get(0).get("replays").get(0).has("groupNumber"));
    }
    @Test void malformedRequiredIntegersCannotDefaultOrTruncateBeforeReachingService() throws Exception {
        for (final String body : List.of(
                "{\"server\":\"CN\",\"nameZh\":\"夏季赛\",\"nameEn\":\"Summer\",\"startDate\":null}",
                "{\"server\":\"CN\",\"year\":null,\"nameZh\":\"夏季赛\",\"nameEn\":\"Summer\",\"startDate\":null}",
                "{\"server\":\"CN\",\"year\":2026.5,\"nameZh\":\"夏季赛\",\"nameEn\":\"Summer\",\"startDate\":null}",
                "{\"server\":\"CN\",\"year\":\"2026\",\"nameZh\":\"夏季赛\",\"nameEn\":\"Summer\",\"startDate\":null}")) {
            mvc.perform(post("/api/admin/tournament-broadcasts/v2/seasons")
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(context.getBean(BroadcastService.class));
    }
    @Test void localizedRequestsRequireBothNamesAndAllowOmittedRussian() throws Exception {
        final String body = "{\"server\":\"CN\",\"year\":2026,\"nameZh\":\"夏季赛\",\"nameEn\":\"Summer\",\"startDate\":null}";
        for (final String missing : List.of("nameZh", "nameEn")) {
            final var tree = new JsonMapper().readTree(body);
            ((tools.jackson.databind.node.ObjectNode) tree).remove(missing);
            mvc.perform(post("/api/admin/tournament-broadcasts/v2/seasons")
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                    .contentType("application/json").content(tree.toString())).andExpect(status().isBadRequest());
            final var update = (tools.jackson.databind.node.ObjectNode) tree;
            update.remove("server"); update.put("expectedVersion",2);
            mvc.perform(put("/api/admin/tournament-broadcasts/v2/seasons/1")
                    .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                    .contentType("application/json").content(update.toString())).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(context.getBean(BroadcastService.class));
        mvc.perform(post("/api/admin/tournament-broadcasts/v2/seasons")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                .contentType("application/json").content(body)).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastDtos.SeasonCreate> request = ArgumentCaptor.forClass(BroadcastDtos.SeasonCreate.class);
        verify(context.getBean(BroadcastService.class)).createSeason(request.capture());
        assertEquals("夏季赛",request.getValue().nameZh()); assertEquals("Summer",request.getValue().nameEn());
        assertEquals(null,request.getValue().nameRu());
    }
    @Test void multipartJsonUsesTheSameStrictDtoForCreateAndUpdate() throws Exception {
        final String json = "{\"expectedVersion\":2,\"title\":\"Title\",\"url\":\"https://example.org/replay\",\"matchDate\":\"2026-10-16\",\"dayNumber\":9,\"groupNumber\":12,\"bracket\":null,\"teams\":[\"Followed\",\"Other\"],\"perspective\":\"POV\",\"coverAction\":\"KEEP\"}";
        final MockMultipartFile payload = new MockMultipartFile("payload", "", "application/json", json.getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/tournament-broadcasts/v2/replays/4").file(payload)
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isOk());
        final ArgumentCaptor<BroadcastDtos.ReplaySave> request = ArgumentCaptor.forClass(BroadcastDtos.ReplaySave.class);
        verify(context.getBean(BroadcastService.class)).updateReplay(eq(4L), request.capture(), eq(null));
        assertEquals(LocalDate.of(2026,10,16), request.getValue().matchDate()); assertEquals(9, request.getValue().dayNumber()); assertEquals(12, request.getValue().groupNumber());
        final MockMultipartFile malformed = new MockMultipartFile("payload", "", "application/json",
                json.replace("\"dayNumber\":9", "\"dayNumber\":2.5").getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/admin/tournament-broadcasts/v2/nodes/3/replays").file(malformed)
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isBadRequest());
    }
    @Test void deleteRequiresExplicitConfirmationAndVersionAndReturnsNoContent() throws Exception {
        mvc.perform(delete("/api/admin/tournament-broadcasts/v2/replays/4?expectedVersion=2")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/admin/tournament-broadcasts/v2/replays/4?expectedVersion=2&confirm=true")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isNoContent());
        verify(context.getBean(BroadcastService.class)).deleteReplay(4,2,true);
    }
    @Test void unknownRequestFieldsCannotOverrideInheritedIdentityOrNodeConfiguration() throws Exception {
        mvc.perform(post("/api/admin/tournament-broadcasts/v2/seasons")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))
                .contentType("application/json")
                .content("{\"server\":\"CN\",\"year\":2026,\"nameZh\":\"夏季赛\",\"nameEn\":\"Summer\",\"startDate\":null,\"serverOverride\":\"LESTA\"}"))
                .andExpect(status().isBadRequest());
        final String replay = "{\"expectedVersion\":2,\"title\":\"Title\",\"url\":\"https://example.org/replay\",\"matchDate\":\"2026-10-16\",\"dayNumber\":9,\"groupNumber\":12,\"bracket\":null,\"teams\":[\"Followed\",\"Other\"],\"perspective\":\"POV\",\"coverAction\":\"KEEP\"";
        for (final String extra : List.of("\"groupLabel\":\"A\"", "\"nodeId\":42", "\"roundNumber\":4", "\"format\":\"KNOCKOUT\"")) {
            final MockMultipartFile payload = new MockMultipartFile("payload","","application/json",
                    (replay + "," + extra + "}").getBytes(StandardCharsets.UTF_8));
            mvc.perform(multipart("/api/admin/tournament-broadcasts/v2/nodes/3/replays").file(payload)
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
        return new BroadcastDtos.Season(1,"LESTA",2026,"夏季赛","Summer",null,null,Instant.parse("2026-10-16T00:00:00Z"),2,1,1);
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
