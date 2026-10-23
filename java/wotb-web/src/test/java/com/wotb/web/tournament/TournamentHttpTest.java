package com.wotb.web.tournament;
import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.tournament.controller.TournamentAdminController;
import com.wotb.web.tournament.controller.TournamentController;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.service.TournamentService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import java.util.Map;
import java.time.Instant;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

class TournamentHttpTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    @BeforeEach void setup() {
        context=new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext()); context.register(TestConfig.class); context.refresh();
        mvc=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    @AfterEach void close(){context.close();}
    @Test void previousBackendListHeadDoesNotAdvertiseDefaultRules() throws Exception {
        final MockMvc legacy=MockMvcBuilders.standaloneSetup(new PreviousEventIdController())
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        legacy.perform(get("/api/admin/tournaments/1")).andExpect(status().isOk());
        // The former one-segment candidate collides with the old Long eventId argument.
        legacy.perform(get("/api/admin/tournaments/default-rules")).andExpect(status().isBadRequest());
        legacy.perform(head("/api/admin/tournaments")).andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Tournament-Default-Rules"));
    }
    @Test void csvCapabilitiesSourceAndMultipartRoutesKeepPublicAndAdminBoundaries() throws Exception {
        final var service = context.getBean(TournamentService.class);
        when(service.listEvents()).thenReturn(List.of());
        when(service.dataSource(1)).thenReturn(new TournamentDtos.DataSource(true, new TournamentDtos.Attribution("_EK_", "https://b23.tv/rqx5iYX")));
        final var event = new TournamentDtos.Event(1, 4, 2026, "CN", "FIRE_CUP", 5, 2, List.of("Day 1", "Day 2"), true);
        final var preview = new TournamentDtos.CsvImportPreview(new TournamentDtos.Standings(event, List.of(), List.of()),
                "standings.csv", "a".repeat(64), 200, 200, 1800, 4, new TournamentDtos.CsvChanges(200, 0, 0, 200, 0, 0, 0));
        when(service.previewCsv(eq(1L), eq(4L), any())).thenReturn(preview);
        when(service.importCsv(any(), eq(1L), eq(4L), any(), eq("a".repeat(64)), eq(true), eq("csv-key"))).thenReturn(preview);
        mvc.perform(get("/api/tournaments")).andExpect(status().isOk()).andExpect(header().string("X-Tournament-Csv-Import", "1")).andExpect(jsonPath("$").isArray());
        mvc.perform(head("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(header().string("X-Tournament-Csv-Import", "1"));
        mvc.perform(get("/api/tournaments/1/data-source")).andExpect(status().isOk()).andExpect(jsonPath("$.csvImported").value(true))
                .andExpect(jsonPath("$.attribution.name").value("_EK_")).andExpect(jsonPath("$.attribution.url").value("https://b23.tv/rqx5iYX"));
        mvc.perform(head("/api/tournaments/1/data-source")).andExpect(status().isUnauthorized());
        final var file = new MockMultipartFile("file", "standings.csv", "text/csv", new byte[]{1});
        mvc.perform(multipart("/api/admin/tournaments/1/csv-import/preview").file(file).param("expectedEventVersion", "4")).andExpect(status().isUnauthorized());
        mvc.perform(multipart("/api/admin/tournaments/1/csv-import/preview").file(file).param("expectedEventVersion", "4")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isForbidden());
        mvc.perform(multipart("/api/admin/tournaments/1/csv-import/preview").file(file).param("expectedEventVersion", "4")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sourceRowCount").value(200)).andExpect(jsonPath("$.changes.addedScores").value(200));
        mvc.perform(multipart("/api/admin/tournaments/1/csv-import").file(file).param("expectedEventVersion", "4")
                .param("sourceSha256", "a".repeat(64)).param("confirm", "true").param("idempotencyKey", "csv-key")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isOk());
        mvc.perform(multipart("/api/admin/tournaments/1/csv-import").file(file).param("expectedEventVersion", "4")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isBadRequest());
        final var json = JsonMapper.builder().findAndAddModules().build();
        assertEquals(8, json.valueToTree(preview).properties().size());
        assertEquals(2, json.valueToTree(new TournamentDtos.DataSource(false, null)).properties().size());
        assertEquals(true, json.valueToTree(new TournamentDtos.DataSource(false, null)).has("attribution"));
    }
    @Test void auditEndpointKeepsMetadataAndEmptySnapshotObjectsInTheExistingWireShape() throws Exception {
        final var metadata = new TournamentDtos.Audit(7, "CSV_IMPORTED", "admin", null, null, null,
                Instant.parse("2026-10-16T15:00:00Z"), Map.of(), Map.of());
        when(context.getBean(TournamentService.class).auditList(1)).thenReturn(List.of(metadata));
        final var result = mvc.perform(get("/api/admin/tournaments/1/audit")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].action").value("CSV_IMPORTED"))
                .andExpect(jsonPath("$[0].before").isEmpty()).andExpect(jsonPath("$[0].after").isEmpty()).andReturn();
        final var json = JsonMapper.builder().findAndAddModules().build().readTree(result.getResponse().getContentAsString());
        assertEquals(9, json.get(0).properties().size()); assertEquals(true, json.get(0).has("before")); assertEquals(true, json.get(0).has("after"));
    }
    @RestController
    static class PreviousEventIdController {
        @GetMapping("/api/admin/tournaments")
        List<TournamentDtos.Event> list() { return List.of(); }
        @GetMapping("/api/admin/tournaments/{eventId}")
        long config(@PathVariable("eventId") final long eventId) { return eventId; }
    }
    @Test void onlyPublicGetsAndExplicitTournamentRoleMayReachTournamentRoutes() throws Exception {
        when(context.getBean(TournamentService.class).listEvents()).thenReturn(List.of());
        mvc.perform(get("/api/tournaments")).andExpect(status().isOk());
        mvc.perform(get("/api/admin/tournaments")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin")))).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isOk());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"),new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isOk());
        mvc.perform(get("/api/tournaments/1/evidence/x")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))).andExpect(status().isForbidden());
    }
    @Test void globalDefaultsHaveStrictSerializationAndTournamentAdminAuthorization() throws Exception {
        final var service=context.getBean(TournamentService.class);
        final var inactive=new TournamentDtos.DefaultRules(7,false,null,"",null,List.of());
        when(service.defaultRules()).thenReturn(inactive);
        when(service.ruleSource(1)).thenReturn(new TournamentDtos.RuleSource(3,"INHERIT",7L,false,false));
        when(service.setDefaultRules(any(),any())).thenReturn(inactive); when(service.clearDefaultRules(any(),any())).thenReturn(inactive);
        when(service.saveDefaultConfiguration(any(),any())).thenReturn(inactive);
        when(service.listEvents()).thenReturn(List.of());
        mvc.perform(head("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(header().string("X-Tournament-Default-Rules","1"));
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(header().string("X-Tournament-Default-Rules","1")).andExpect(jsonPath("$").isArray());
        mvc.perform(get("/api/admin/tournaments/rules/default")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/tournaments/rules/default").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin")))).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/tournaments/rules/default").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(7)).andExpect(jsonPath("$.active").value(false));
        mvc.perform(get("/api/admin/tournaments/1/rule-source").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("INHERIT")).andExpect(jsonPath("$.isDefaultSource").value(false)).andExpect(jsonPath("$.defaultVersion").value(7));
        mvc.perform(put("/api/admin/tournaments/rules/default").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))
                .contentType("application/json").content("{\"eventId\":1,\"expectedEventVersion\":3,\"expectedDefaultVersion\":7,\"confirm\":true}"))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/admin/tournaments/rules/default").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))
                .contentType("application/json").content("{\"expectedDefaultVersion\":7,\"confirm\":true}"))
                .andExpect(status().isOk());
        final var points=List.of(new TournamentDtos.RankPoints(1,100),new TournamentDtos.RankPoints(2,50),
                new TournamentDtos.RankPoints(3,25),new TournamentDtos.RankPoints(4,0));
        final var ruleDays=List.of(new TournamentDtos.RuleDay(1,points),new TournamentDtos.RuleDay(2,points));
        final var configuration=new TournamentDtos.DefaultConfigurationRequest(7,true,
                java.util.stream.IntStream.rangeClosed(1,4).mapToObj(round->new TournamentDtos.DefaultRound(round,ruleDays)).toList());
        mvc.perform(put("/api/admin/tournaments/rules/default/configuration").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))
                .contentType("application/json").content(JsonMapper.builder().findAndAddModules().build().writeValueAsString(configuration)))
                .andExpect(status().isOk());
        final var json=JsonMapper.builder().findAndAddModules().build();
        assertEquals(6,json.valueToTree(inactive).properties().size()); assertEquals(true,json.valueToTree(inactive).has("sourceEventId"));
        assertThrows(tools.jackson.core.JacksonException.class,()->json.readValue("{\"expectedDefaultVersion\":7}",TournamentDtos.ClearDefaultRulesRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->json.readValue("{\"expectedEventVersion\":0,\"expectedDayVersion\":0,\"expectedGroupCount\":1,\"expectedDefaultVersion\":1.2}",TournamentDtos.ExpectedGroupsRequest.class));
    }
    @Test void publicStandingsSerializationContainsOnlyProjectionAndExplicitMissingCells() throws Exception {
        final TournamentDtos.Event event=new TournamentDtos.Event(1,2,2026,"EU","SUMMER",4,3,List.of("Day 1","Day 2","Day 3"),true);
        final TournamentDtos.Standings board=new TournamentDtos.Standings(event,List.of(new TournamentDtos.StandingDay(1,1,"Day 1",true)),
                List.of(new TournamentDtos.StandingRow(1,"25时",100,List.of(new TournamentDtos.RoundPoints(1,100,List.of(new TournamentDtos.DayPoints(1,100L),new TournamentDtos.DayPoints(2,null)))))));
        when(context.getBean(TournamentService.class).publicStandings(1)).thenReturn(board);
        mvc.perform(get("/api/tournaments/1/standings")).andExpect(status().isOk()).andExpect(jsonPath("$.rows[0].clanTag").value("25时"))
                .andExpect(jsonPath("$.rows[0].rounds[0].days[1].points").doesNotExist()).andExpect(jsonPath("$.groups").doesNotExist()).andExpect(jsonPath("$.clans").doesNotExist());
        final var node=JsonMapper.builder().findAndAddModules().build().valueToTree(board);
        assertEquals(3,node.properties().size()); assertEquals(true,node.path("rows").get(0).path("rounds").get(0).path("days").get(1).has("points"));
    }
    @Test void requiredVersionAndRankPointsCannotSilentlyDefaultToZero() throws Exception {
        final var mapper=JsonMapper.builder().findAndAddModules().build();
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"expectedDayVersion\":0}",TournamentDtos.Versions.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"rank\":1}",TournamentDtos.RankPoints.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"expectedEventVersion\":null,\"expectedDayVersion\":0}",TournamentDtos.Versions.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"rank\":1,\"points\":100.5}",TournamentDtos.RankPoints.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"rank\":1,\"points\":\"100\"}",TournamentDtos.RankPoints.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"expectedEventVersion\":0.1,\"expectedDayVersion\":0}",TournamentDtos.Versions.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue("{\"clanTag\":\"A\",\"rank\":1.5}",TournamentDtos.Team.class));
        assertEquals(100,mapper.readValue("{\"rank\":1.0,\"points\":100.0}",TournamentDtos.RankPoints.class).points());
        mvc.perform(post("/api/admin/tournaments/1/rounds/1/days/1/finalize").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin")))
                .contentType("application/json").content("{\"expectedDayVersion\":0,\"expectedRulesVersion\":1,\"idempotencyKey\":\"test\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(context.getBean(TournamentService.class));
    }
    @Test void historicalImportUsesStrictJacksonCellReadersAndPreservesExplicitNulls() throws Exception {
        final var mapper=JsonMapper.builder().findAndAddModules().build();
        final String base="{\"expectedEventVersion\":0,\"sourceName\":\"summer.png\",\"sourceSha256\":\""+"a".repeat(64)+"\",\"rows\":[{\"clanTag\":\"25时\",\"points\":[null,0,100],\"sourceTotal\":100}]}";
        final TournamentDtos.HistoricalPreviewRequest request=mapper.readValue(base,TournamentDtos.HistoricalPreviewRequest.class);
        assertEquals(0,request.rows().getFirst().points().get(1)); assertEquals(null,request.rows().getFirst().points().getFirst());
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("null,0,100","null,0,100.5"),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("null,0,100","null,0,\"100\""),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("\"sourceTotal\":100","\"sourceTotal\":\"100\""),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace(",\"sourceTotal\":100",""),TournamentDtos.HistoricalPreviewRequest.class));
        assertThrows(tools.jackson.core.JacksonException.class,()->mapper.readValue(base.replace("\"sourceTotal\":100","\"sourceTotal\":100.5"),TournamentDtos.HistoricalPreviewRequest.class));
    }
    @Test void historicalImportEndpointsAreAdminOnlyAndReturnExplicitPreviewShape() throws Exception {
        final TournamentDtos.Event event=new TournamentDtos.Event(1,0,2026,"CN","SUMMER",5,2,List.of("小组赛","决赛圈"),false);
        final TournamentDtos.HistoricalPreview response=new TournamentDtos.HistoricalPreview(new TournamentDtos.Standings(event,List.of(),List.of()),32,32,4,0);
        when(context.getBean(TournamentService.class).previewHistorical(eq(1L),any())).thenReturn(response);
        final String request="{\"expectedEventVersion\":0,\"sourceName\":\"summer.png\",\"sourceSha256\":\""+"a".repeat(64)+"\",\"rows\":[]}";
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").contentType("application/json").content(request)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin"))).contentType("application/json").content(request)).andExpect(status().isForbidden());
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))).contentType("application/json").content(request))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sourceRowCount").value(32)).andExpect(jsonPath("$.clanCount").value(32)).andExpect(jsonPath("$.missingCellCount").value(4)).andExpect(jsonPath("$.eventVersion").value(0));
        mvc.perform(post("/api/admin/tournaments/1/historical-import/preview").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"),new SimpleGrantedAuthority("ROLE_tournament-admin"))).contentType("application/json").content(request)).andExpect(status().isOk());
        mvc.perform(post("/api/admin/tournaments/1/historical-import").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))).contentType("application/json").content(request))
                .andExpect(status().isBadRequest());
    }
    @Test void dayResponseExposesCanonicalFactsOnlyOnTheAuthenticatedAdminSurface() throws Exception {
        final TournamentDtos.Event event=new TournamentDtos.Event(1,1,2026,"CN","SUMMER",5,2,List.of("小组赛","决赛圈"),true);
        final TournamentDtos.Standings board=new TournamentDtos.Standings(event,List.of(),List.of());
        final TournamentDtos.DayView day=new TournamentDtos.DayView(1,1,1,1,0,1,"FINALIZED",null,List.of(),true,board,board);
        final TournamentDtos.DayView normalDay=new TournamentDtos.DayView(1,1,1,1,0,1,"FINALIZED",null,List.of(),true,board,null);
        when(context.getBean(TournamentService.class).day(1,1,1,false)).thenReturn(normalDay);
        when(context.getBean(TournamentService.class).day(1,1,1,true)).thenReturn(day);
        when(context.getBean(TournamentService.class).historicalState(1,1,1)).thenReturn(new TournamentDtos.HistoricalState(1,true,false,true));
        final String dayPath="/api/admin/tournaments/1/rounds/1/days/1";
        mvc.perform(get(dayPath)).andExpect(status().isUnauthorized());
        mvc.perform(get(dayPath).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin")))).andExpect(status().isForbidden());
        mvc.perform(get(dayPath).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("FINALIZED"))
                .andExpect(jsonPath("$.canonicalStandings").doesNotExist()).andExpect(jsonPath("$.historical").doesNotExist());
        mvc.perform(get(dayPath).queryParam("includeCanonicalStandings", "true").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.canonicalStandings.rows").isArray());
        final String statePath="/api/admin/tournaments/1/historical-import?roundNumber=1&dayNumber=1";
        mvc.perform(get(statePath)).andExpect(status().isUnauthorized());
        mvc.perform(get(statePath).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin")))).andExpect(status().isForbidden());
        mvc.perform(get(statePath).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.imported").value(true)).andExpect(jsonPath("$.canImport").value(false)).andExpect(jsonPath("$.historical").value(true));
    }
    @Configuration @EnableWebMvc
    @Import({SecurityConfig.class,ApiErrorTestConfig.class,GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean JwtDecoder jwtDecoder(){return mock(JwtDecoder.class);}
        @Bean TournamentService service(){return mock(TournamentService.class);}
        @Bean TournamentController publicController(final TournamentService service){return new TournamentController(service);}
        @Bean TournamentAdminController adminController(final TournamentService service){return new TournamentAdminController(service);}
    }
}
